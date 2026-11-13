// Script generation with the local model. The validated config drives everything:
//   language  → writing rules (Devanagari / Roman Hinglish + Devanagari "say" / English) and the output check
//   personality → voice/tone instructions + delivery timing
//   duration  → a word budget from measured Kokoro speaking rates, and the number of lines (≈ one cut per line)
// Every line also carries an English "visual" description (what the viewer should see) and an optional on-screen
// text, which the storyboard planner turns into scenes.
import { findTopicFacts, factsBlock, reviewClaims } from './factcheck.js';
import fs from 'node:fs';
import path from 'node:path';
import { chat, ensureServer, modelInfo } from './llm.js';
import { getCatalog, LANGUAGES } from './catalog.js';
import { devanagariToHinglish, hinglishCaption, skeleton } from './translit.js';
import { SCIENCE_TERMS } from './glossary.js';
import { PATHS } from './workspace.js';

// Words per second of speech at speed 1.0. Defaults measured from completed renders (Hindi hm_omega/hf_alpha ≈ 2.5,
// English am_michael ≈ 2.5, bm_george ≈ 2.2); refined per voice after every TTS stage (logs/calibration/voices.json).
export const WPS = { en: 2.35, hi: 2.5 };
const CAL_FILE = path.join(PATHS.logs, 'calibration', 'voices.json');
function readCal() { try { return JSON.parse(fs.readFileSync(CAL_FILE, 'utf8')); } catch { return {}; } }

// ── voice calibration (per voice AND language, clean samples only) ──────────────────────────────────────────────
// Before: one rolling mean per voice; any run counted (the only hm_psi sample came from a narration whose every line
// carried junk text), and a single sample became the voice's speed. Now:
//  · samples are stored under "voice|language" in cal.v2 and only from CLEAN narration (no emoji, stray quoted
//    fragments, Marathi words or Latin letters in Devanagari voice text); rejected runs are logged with a reason;
//  · < 3 clean samples → a conservative provisional rate (reference rate assumed 10 % slower) blended toward the
//    measured median by n/3; ≥ 3 → the median, so one abnormal sample cannot distort it;
//  · each sample keeps the estimate and the actual duration so the estimate error can be tracked.
export const HINDI_CPS = 9.1;   // letters/s, measured on hf_alpha (reference Hindi voice)
const PROVISIONAL = 0.9, MIN_SAMPLES = 3;
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
/** pure: the rate to use from clean samples (exported for tests) */
export function calibratedRate(defaultRate, samples) {
  const n = samples.length;
  if (!n) return { rate: +(defaultRate * PROVISIONAL).toFixed(3), confidence: 'default (provisional, no clean samples)', samples: 0 };
  const med = median(samples), prov = defaultRate * PROVISIONAL;
  if (n >= MIN_SAMPLES) return { rate: +med.toFixed(3), confidence: `measured (${n} clean samples, median)`, samples: n };
  return { rate: +(prov + (med - prov) * (n / MIN_SAMPLES)).toFixed(3), confidence: `provisional (${n}/${MIN_SAMPLES} clean samples)`, samples: n };
}
const calKey = (config) => `${config.narration.voice}|${config.language.id}`;
function cleanSamples(config, field) { const e = readCal().v2?.[calKey(config)]; return (e?.samples || []).map((s) => s[field]).filter((x) => x > 0); }
/** calibration status for a voice + language (rate, confidence, estimate error) */
export function calibrationInfo(config) {
  const e = readCal().v2?.[calKey(config)] || { samples: [], rejected: [] };
  const errs = (e.samples || []).filter((s) => s.estimated && s.actual).map((s) => (s.estimated - s.actual) / s.actual);
  return { key: calKey(config), clean: (e.samples || []).length, rejected: (e.rejected || []).length, meanEstimateError: errs.length ? +(errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(3) : null,
    ...(config.language.code === 'hi' && config.language.script === 'Deva' ? calibratedRate(HINDI_CPS, cleanSamples(config, 'cps')) : calibratedRate(wpsDefault(config), cleanSamples(config, 'wps'))) };
}
// Hinglish captions count Roman words, but the Hindi voice reads the longer Devanagari form: measured ≈1.7 caption
// words/s at the reference rate (a 60 s Hinglish script of 116–144 words lasted 72–93 s at the Hindi rate of 2.5)
const wpsDefault = (config) => (config.language.code === 'hi' && config.language.script !== 'Deva' ? 1.7 : (WPS[config.language.code] || 2.4));
export function wpsFor(config) { return calibratedRate(wpsDefault(config), cleanSamples(config, 'wps')).rate; }
export function hindiCps(config) { return calibratedRate(HINDI_CPS, cleanSamples(config, 'cps')).rate; }

/** why a narration run must not be used for calibration ('' = clean) */
export function contaminationReason(lines, config) {
  for (const [i, l] of (lines || []).entries()) {
    const t = String(l.say || l.text || '');
    if (/\p{Extended_Pictographic}/u.test(t)) return `line ${i + 1}: emoji`;
    if (/[”"]\s*,\s*[“"”]/.test(t)) return `line ${i + 1}: stray quoted fragments`;
    if (config.language.code === 'hi' && marathiWords(t)) return `line ${i + 1}: Marathi words`;
    if ((config.language.script === 'Deva' || config.language.id === 'hinglish') && /[A-Za-z]{2,}/.test(String(l.say || (config.language.script === 'Deva' ? l.text : '')))) return `line ${i + 1}: Latin letters in the Devanagari voice text`;
  }
  return '';
}
/** after TTS: record one clean measurement (or log why it was rejected). Rates are normalised to speed 1.0. */
export function recordVoiceRate(config, { lines, speechSeconds, speed = 1, estimatedSeconds = null, actualSeconds = null }) {
  const words = (lines || []).reduce((a, l) => a + countWords(l.say || l.text), 0), chars = (lines || []).reduce((a, l) => a + letters(l.say || l.text), 0);
  const all = readCal(); all.v2 = all.v2 || {};
  const e = all.v2[calKey(config)] = all.v2[calKey(config)] || { samples: [], rejected: [] };
  const why = !(words > 10 && speechSeconds > 4) ? 'too short to measure' : contaminationReason(lines, config);
  if (why) e.rejected = [...(e.rejected || []), { at: new Date().toISOString(), reason: why }].slice(-20);
  else e.samples = [...(e.samples || []), { at: new Date().toISOString(), wps: +(words / speechSeconds / speed).toFixed(3), cps: +(chars / speechSeconds / speed).toFixed(3), estimated: estimatedSeconds, actual: actualSeconds }].slice(-10);
  fs.mkdirSync(path.dirname(CAL_FILE), { recursive: true }); fs.writeFileSync(CAL_FILE, JSON.stringify(all, null, 1));
  return why ? { recorded: false, reason: why } : { recorded: true };
}

export function wordBudget(config, nLines) {
  const d = config.narration.delivery, wps = wpsFor(config);
  const speech = config.durationSeconds - d.lead - d.outro - Math.max(0, nLines - 1) * d.gap * 0.7;
  return Math.max(20, Math.round(speech * wps * config.narration.speed));
}
// one line ≈ 4.2 s of narration: at 3.4 s Hindi lines were ~7 words and the model wrote clipped fragments that did not
// connect ("पांच नवंबर 2013 को, लॉन्च हुआ था।"); slightly longer lines leave room for complete, linked sentences
// (English too: at 3.4 s a 45 s English script had 13 lines of ~6 words and the model wrote telegraphic fragments —
// "Circulation's complex, a powerful system." — and still undershot the length)
// ~6 s per line: each line is one story beat of one or two sentences (a good 45 s reference script has 7 lines);
// at 4.2 s lines were short, exclamatory and disconnected
export function lineCount(config) { return Math.max(5, Math.min(12, Math.round(config.durationSeconds / 6.2))); }

export const countWords = (s) => String(s || '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
// Hindi: spoken length tracks letters far better than words (measured 8.96–9.79 letters/s across 4 narrations vs
// 2.10–2.76 words/s), so Devanagari narration is estimated by letters (incl. matras); English by words.
export const letters = (s) => String(s || '').replace(/[^\p{L}\p{M}\p{N}]/gu, '').length;
// A number is spoken as several words: "16,470" → "sixteen thousand four hundred seventy" (5), "1942" → "nineteen
// forty-two" (2–3), "2013" → "दो हज़ार तेरह". Counting it as one word made a number-heavy English script estimate
// 30.8 s and narrate 36.9 s (job stopped at TTS). English only: extra spoken words per number.
const NUM_TOKEN = /\d[\d,]*(?:\.\d+)?/g;
function numberExtraWords(s) {
  let extra = 0;
  for (const m of String(s || '').match(NUM_TOKEN) || []) {
    const digits = m.replace(/[^\d]/g, '').length, year = /^(1[0-9]|20)\d\d$/.test(m);
    const spoken = year ? 2.5 : digits <= 2 ? 1.2 : digits === 3 ? 2.2 : digits + (m.includes('.') ? 1 : -0.6);
    extra += Math.max(0, spoken - 1);
  }
  return extra;
}

export function estimateSeconds(script, config) {
  const d = config.narration.delivery, wps = wpsFor(config);
  const words = script.lines.reduce((a, l) => a + countWords(l.say || l.text), 0);
  const spokenWords = words + script.lines.reduce((a, l) => a + numberExtraWords(l.say || l.text), 0);
  // Hindi: the measured letters-per-second rate already includes digits as spoken (a number-heavy ISRO script
  // estimated 47.0 s with extra letters per digit but narrated within its 40 s target), so no expansion there
  const speech = config.language.code === 'hi' ? script.lines.reduce((a, l) => a + letters(l.say || l.text), 0) / (hindiCps(config) * config.narration.speed) : spokenWords / (wps * config.narration.speed);
  const fixed = d.lead + d.outro + Math.max(0, script.lines.length - 1) * d.gap * 0.7;
  return { words, speechSeconds: +speech.toFixed(1), seconds: +(speech + fixed).toFixed(1), targetSpeech: +(config.durationSeconds - fixed).toFixed(1) };
}

const DEVA = /[ऀ-ॿ]/g, LATIN = /[A-Za-z]/g;
const ratio = (s) => { const d = (s.match(DEVA) || []).length, l = (s.match(LATIN) || []).length; return { d, l, deva: d / Math.max(1, d + l) }; };

/** checks that the script really is in the selected language/script. Returns a list of problems. */
export function checkLanguage(script, config) {
  const lang = config.language, problems = [];
  script.lines.forEach((l, i) => {
    const r = ratio(l.text);
    if (lang.script === 'Deva' && r.deva < 0.85) problems.push(`line ${i + 1} is not in Devanagari: "${l.text.slice(0, 50)}"`);
    // letters of any other script (seen: Cyrillic "бюдजीट" inside a Hindi line) are unreadable for voice and viewer
    const foreign = [...new Set(String(l.say || l.text).match(/[^\s\p{Script=Devanagari}\p{Script=Latin}\p{N}\p{P}\p{S}\p{M}]/gu) || [])];
    if (foreign.length) problems.push(`line ${i + 1} contains letters from another script (${foreign.slice(0, 6).join('')}): rewrite that word`);
    if (lang.script === 'Latn' && r.d > 0) problems.push(`line ${i + 1} contains Devanagari but ${lang.name} captions must be Roman script`);
    if (lang.id === 'hinglish') { const s = ratio(l.say || ''); if (!l.say || s.deva < 0.85) problems.push(`line ${i + 1} is missing its Devanagari "say" form`); }
  });
  if (lang.code === 'en') {
    const hinglishMarkers = script.lines.filter((l) => /\b(hai|kya|aur|nahi|kaise|bhi|toh|yeh|woh|mein)\b/i.test(l.text)).length;
    if (hinglishMarkers > script.lines.length * 0.3) problems.push('the script reads as Hinglish, not English');
  } else if (lang.id === 'hinglish') {
    const markers = script.lines.filter((l) => /\b(hai|kya|aur|nahi|kaise|bhi|toh|yeh|woh|mein|ka|ki|ke|se|ko|ne)\b/i.test(l.text)).length;
    if (markers < script.lines.length * 0.4) problems.push('the script reads as English, not Hinglish');
  }
  // Hindi / Hinglish voice text: Marathi shares Devanagari, so the script check cannot see it (seen in a Hindi script:
  // "या गतीमुळे सर्व काही पुढे सरकत राहते", "थांबल्यास … घडून येईल"). Words that exist in Marathi but not Hindi.
  if (lang.code === 'hi') {
    const mr = script.lines.map((l, i) => (marathiWords(l.say || l.text) >= 1 ? i + 1 : 0)).filter(Boolean);
    if (mr.length) problems.push(`lines ${mr.join(', ')} are Marathi, not Hindi: rewrite them in Hindi`);
  }
  // emoji or stray quoted fragments in a narration line are read aloud or break the voice
  const junk = script.lines.map((l, i) => (/\p{Extended_Pictographic}/u.test(String(l.say || l.text)) || /[”"]\s*,\s*[“"”]/.test(String(l.say || l.text)) ? i + 1 : 0)).filter(Boolean);
  if (junk.length) problems.push(`lines ${junk.join(', ')} contain emoji or stray quoted fragments`);
  return problems;
}
const MARATHI = /(?:^|[\s,।])(आहे|आहेत|नाहीत|च्या|मुळे|गतीमुळे|ल्यास|थांबल्यास|आणि|होईल|राहील|राहते|राहतो|घडून|येईल|सरकेल|सरकत|पूर्वेकडे|तासाच्या|वेगाने|सर्व काही|करतात|असते|असतो|झाले|झाला|आपण|त्यामुळे|ज्यामुळे)(?=[\s,।!?]|$)/g;
export const marathiWords = (t) => (String(t || '').match(MARATHI) || []).length;

function schemaFor(config, n, perLine = 14) {
  const hing = config.language.id === 'hinglish';
  // character caps per field: a 4B model sometimes loops inside one string until max_tokens (seen on Hindi: 2000 tokens
  // of repeated text → invalid JSON on all 5 attempts); llama.cpp enforces maxLength in the sampling grammar
  const textMax = Math.max(90, Math.round(perLine * (config.language.script === 'Deva' ? 9 : 8)));
  // Hinglish: the model also lists the English words it used, so captions can keep their English spelling
  const line = { type: 'object', properties: { text: { type: 'string', maxLength: textMax }, visual: { type: 'string', maxLength: 220 }, onScreen: { type: 'string', maxLength: 48 }, ...(hing ? { english: { type: 'array', items: { type: 'string' }, maxItems: 10 } } : {}) },
    required: hing ? ['text', 'visual', 'english'] : ['text', 'visual'], additionalProperties: false };
  return { type: 'object', properties: { title: { type: 'string', maxLength: 80 }, lines: { type: 'array', items: line, minItems: Math.max(4, n - 3), maxItems: n + 3 } }, required: ['title', 'lines'], additionalProperties: false };
}

function prompt(config, n, budget, facts, topicFacts = null, plan = null, names = {}) {
  const cat = getCatalog(), lang = cat.languages.find((l) => l.id === config.language.id), pers = cat.personalities.find((p) => p.id === config.narration.personality);
  const sys = [
    'You write narration scripts for vertical YouTube Shorts for an Indian audience. Output ONLY JSON matching the schema.',
    `LANGUAGE: ${lang.name}. ${lang.writing}`,
    `NARRATOR PERSONALITY: ${pers.name}. ${pers.voice}`,
    `LENGTH (strict): exactly ${n} lines of about ${Math.round(budget / n)} words each, about ${budget} spoken words in total and never more than ${Math.round(budget * 1.12)} (the narration must fit ${config.durationSeconds} seconds). Each line is one camera cut. End each sentence with proper punctuation${config.language.script === 'Deva' ? ' (। or ? or !)' : ''}.`,
    `AUDIENCE-FIRST STRUCTURE (adapt it to the topic and duration; the viewer may know NOTHING about the subject): (1) HOOK — a curiosity question or surprising statement that already contains the specific idea of THIS topic (a question like "Have you ever wondered why …?" / "क्या आप जानते हैं कि … ?" is welcome when it names the specific idea; vary the form between videos; never an empty opener like "सुनो", "एक मिनट", "आज हम बात करेंगे", "today we will talk about"). (2) BRIDGE — briefly say what the subject is, in plain words, so a beginner can follow. (3) EXPLAIN — step by step; explain every unfamiliar term the first time it appears; a simple analogy ("imagine…" / "सोचिए…") helps. (4) SUPPORTING FACTS and a deeper or surprising point. (5) CONCLUSION — what it all means. An ending question to the viewer ("आपको इसके बारे में पहले से पता था?", "What surprised you most?") is welcome when it fits; never "like, share and subscribe" or "amazing achievement / गर्व की बात". The narrator answers every question they ask — a guided explanation, not an interview. Tell ONE central story with concrete details${topicFacts || facts ? ' taken ONLY from the verified facts below' : ''}.`,
    'STYLE: narrate like a calm, cinematic documentary storyteller speaking to one viewer. Each line carries a story beat with its cause or consequence, linked with natural connectors (but, then, because of this / लेकिन, इसके बाद, इसी वजह से). Use at most three exclamation marks in the whole script. No filler reactions ("you will be amazed", "very interesting", "really", "जानकर आप हैरान हो जाएंगे", "बहुत दिलचस्प है"). The last line says what the story MEANS — an emotional or thought-provoking payoff tied to this story.',
    'RELEVANCE AND REPETITION: every line must move the central story forward. Leave out true facts that do not serve it. Never state the same fact or number twice; a later line may compare numbers only to add meaning.',
    'FLOW (very important): all lines together are ONE continuous story told by one narrator. Each line is one story beat: ONE or TWO complete, grammatical sentences (never split a sentence across two lines) that follows naturally from the line before it — when useful, START a sentence with a connecting word (then, but, so, that is why, and yet). Every line ends with a full stop (। in Hindi), ? or ! — never end a line with a connecting word like "and", "so", "then" (तो, फिर, और, इससे). Never write a list of separate facts, never start every line with a date, and never write half-sentences or clipped telegraphic phrases ("Circulation’s complex, a powerful system.") — write the way a person explains something out loud.',
    ...(config.language.script === 'Deva' ? ['HINDI QUALITY: use only real, common, correctly spelled Hindi words — never invent or misspell a word. Bronze is काँसा (never ताँका). Write directly and natively in Hindi (do not compose in English and translate). Write every name in Devanagari (Sher Shah Suri → शेर शाह सूरी, Harappa → हड़प्पा); for science and technology use the words Hindi speakers actually say (ग्रेविटी or गुरुत्वाकर्षण, वैक्सीन, एंटीबॉडी), never a misleading literal translation. Keep gender and number agreement correct (verb, adjective and postposition must agree with the noun). Prefer simple everyday sentences a native speaker would actually say; avoid literal translation from English. The hook must be an intriguing question or surprising statement about the topic itself.'] : []),
    'ACCURACY: only state facts you are confident are true. Prefer well-known facts. Do not invent quotes, statistics, sources, places, parks, people or organisations. If unsure of an exact number, say it approximately or leave it out.',
    'LEGENDS AND THEORIES: never tell a legend, myth or folklore as history: say "legend says" / "according to folklore". Present unproven explanations as theories: "scientists think", "may have". Keep the three apart: verified fact, theory, legend.',
    'Write numbers the way they are spoken in the narration language. Never copy any number, name or example from these instructions into the script: every fact must come from the topic itself.',
    `For EVERY line add "visual": one short sentence IN ENGLISH (Latin letters only, even when the narration is ${lang.name}) describing what the viewer should SEE in that shot (name the concrete subject, what it is doing and the place). Never describe text or captions in "visual".`,
    'Optionally add "onScreen": a very short on-screen text that repeats the key number, year or comparison spoken IN THAT SAME LINE (a number with its unit, a year, or two labelled values joined by "vs"). Never show something the line does not say. Leave it out when the line has no key number. Use the same currency and units the narration uses (if the narration says ₹450 crore, show ₹450 crore, not dollars).',
    '"title": a short catchy title in the same language as the narration.',
    ...(config.language.id === 'hinglish' ? ['HINGLISH FORMAT: "text" is ALWAYS Devanagari — spoken Hindi with common English words written phonetically in Devanagari, never an English sentence and never Roman letters. Format example only (never use its content): {"text": "बारिश के बाद मिट्टी से जो खुशबू आती है, उसकी असली वजह एक बैक्टीरिया है।", "english": ["bacteria"], "visual": "…"}.', 'For EVERY line add "english": the English words used in that line, in normal English spelling (e.g. for "भारत ने क्रिकेट मैच जीता" → ["cricket", "match"]); an empty list when the line has none. Do not list Hindi words.'] : []),
  ].join('\n');
  const user = `Topic: ${config.topic}
${(() => {
    const b = factsBlock(topicFacts, facts); if (!b) return '';
    // a fact file with no numbers: the model invented years and weights to sound concrete ("1947", "20 kg")
    const hasNums = /\d/.test(b.split('THEORIES')[0].split('BELIEFS')[0]);
    return `${b}\n\nNUMBERS: ${hasNums ? 'every year, date, number, weight and statistic in the narration AND the on-screen text must appear in the VERIFIED FACTS above; write no other number.' : 'the verified facts contain NO years, dates or statistics for this topic, so write NO years, dates, weights, percentages or statistics at all — explain with words, not numbers. Leave "onScreen" out or use a short word label.'}\n\n`;
  })()}${planBlock(plan)}${Object.keys(names).length ? 'NAMES AND TERMS — use each exactly as written and in full (never shorten a two-word term to its first word, never swap in a different word): ' + Object.entries(names).map(([k, v]) => k + ' = ' + v).join(', ') + '\n' : ''}Remember: exactly ${n} lines, each one story beat of one or two complete sentences, about ${Math.round(budget / n)} words (at most ${Math.round(budget / n) + 3}) that connects to the previous line, about ${budget} words in total, telling one continuous story.`;
  return [{ role: 'system', content: sys }, { role: 'user', content: user }];
}

// Hinglish: the model sometimes writes the caption line in Devanagari. Keep that as the spoken form and derive the
// Roman caption deterministically, instead of failing (the line is marked so the preview can show it).
const isDeva = (s) => ratio(String(s || '')).deva >= 0.85;
// Hindi (Devanagari) narration: Latin acronyms/names would be read with English phonemes by the Hindi voice, so they
// are written in Devanagari: known names from a small list, other ALL-CAPS acronyms letter by letter (PSLV → पी एस एल वी).
const DEVA_NAMES = { isro: 'इसरो', nasa: 'नासा', india: 'इंडिया', mars: 'मार्स', gravity: 'ग्रेविटी', hollywood: 'हॉलीवुड', bollywood: 'बॉलीवुड', mangalyaan: 'मंगलयान', chandrayaan: 'चंद्रयान', ipl: 'आईपीएल', bcci: 'बीसीसीआई', ai: 'एआई', dna: 'डीएनए', usa: 'अमेरिका', ok: 'ओके', tv: 'टीवी', fort: 'क़िला', boss: 'बॉस', youtube: 'यूट्यूब', google: 'गूगल', internet: 'इंटरनेट', mobile: 'मोबाइल', phone: 'फ़ोन', mission: 'मिशन', budget: 'बजट', rocket: 'रॉकेट', road: 'रोड', roads: 'रोड', cricket: 'क्रिकेट', science: 'साइंस', aarti: 'आरती', arti: 'आरती', aarati: 'आरती', puja: 'पूजा', pooja: 'पूजा', mandir: 'मंदिर', ghanta: 'घंटा', ghanti: 'घंटी', panchdhatu: 'पंचधातु', om: 'ॐ', mantra: 'मंत्र', shiva: 'शिव', ganesh: 'गणेश', bhagwan: 'भगवान', prasad: 'प्रसाद', diya: 'दीया', himalaya: 'हिमालय', himalayas: 'हिमालय', roopkund: 'रूपकुंड', mangal: 'मंगल', isro: 'इसरो', pslv: 'पीएसएलवी', bengaluru: 'बेंगलुरु', sriharikota: 'श्रीहरिकोटा' };
const LETTER = { A: 'ए', B: 'बी', C: 'सी', D: 'डी', E: 'ई', F: 'एफ़', G: 'जी', H: 'एच', I: 'आई', J: 'जे', K: 'के', L: 'एल', M: 'एम', N: 'एन', O: 'ओ', P: 'पी', Q: 'क्यू', R: 'आर', S: 'एस', T: 'टी', U: 'यू', V: 'वी', W: 'डब्ल्यू', X: 'एक्स', Y: 'वाई', Z: 'ज़ेड' };
// a word the model wrote half in Devanagari, half in Latin ("मंगalyaan", "पंचदhatu"): romanize the Devanagari part,
// join the Latin tail and match the known-word list by consonant skeleton → the proper Devanagari spelling
// per-topic Devanagari spellings of names (filled by topicNameSpellings before a Hindi/Hinglish script is written)
const TOPIC_NAMES = {};
const nameFor = (k) => TOPIC_NAMES[k] || DEVA_NAMES[k];
function repairMixedWords(text) {
  return String(text).replace(/[ऀ-ॿ]+[A-Za-z]+[ऀ-ॿA-Za-z]*|[A-Za-z]+[ऀ-ॿ]+[ऀ-ॿA-Za-z]*/g, (tok) => {
    const roman = tok.replace(/[ऀ-ॿ]+/g, (d) => devanagariToHinglish(d).toLowerCase()), key = skeleton(roman);
    const hit = [...Object.keys(TOPIC_NAMES), ...Object.keys(DEVA_NAMES)].find((k) => k.length >= 4 && skeleton(k) === key);
    return hit ? nameFor(hit) : tok;
  });
}
export function devanagarizeLatin(text) {
  return repairMixedWords(text).replace(/[A-Za-z][A-Za-z.]*/g, (w) => {
    const bare = w.replace(/\./g, ''), k = bare.toLowerCase();
    if (nameFor(k)) return nameFor(k);
    if (/^[A-Z]{2,6}$/.test(bare)) return [...bare].map((c) => LETTER[c]).join(' ');
    return w;   // anything else stays and is reported back to the model by the language check
  });
}
export const latinWords = (text) => (String(text).match(/[A-Za-z]{2,}/g) || []);

// Hinglish line → Devanagari "say" for the Hindi voice + a Roman caption built word by word (hinglishCaption): Latin
// words the model wrote stay as written, declared English words and known loanwords keep their English spelling,
// Hindi words are transliterated.
function repairHinglish(l) {
  const hasDeva = (s) => /[ऀ-ॿ]/.test(String(s || ''));
  if (!hasDeva(l.text)) return l;
  const say = l.say && isDeva(l.say) ? l.say : devanagarizeLatin(l.text);
  const cap = hinglishCaption(l.text, l.english);
  return { ...l, say, text: cap.text, english: cap.english, transliterated: true };
}

// a line that stops on a connector reads as cut off (seen after a bad edit: "…घंटा बजाते हैं, फिर")
const DANGLING = /(?:^|[\s,])(?:तो|फिर|और|इससे|इसलिए|क्योंकि|लेकिन|पर|मगर|मानो|जैसे|शायद|कि|या|यानी|जिससे|ताकि|निश्चित रूप से|and|so|then|but|because|or|that)\s*[,;:–-]*\s*[।.!?]?\s*$/i;
// a filler tacked on after a comma reads as padding (seen in English: "…, sadly.", "…, then.", "…, surely.", "but…")
const FILLER_TAIL = /[,،]\s*(?:sadly|then|now|surely|indeed|roughly speaking|basically|actually|really|truly|of course|you know|you see|right|too|again|still|sure|सच में|वाकई|बिल्कुल|ना|है ना|समझे)\s*[।.!?…]*\s*$|\b(?:but|and|so)\s*(?:…|\.\.\.)\s*$/i;
export const danglingLine = (t) => DANGLING.test(String(t || '').trim()) || /,\s*[।.]?\s*$/.test(String(t || '').trim());
export const fillerTail = (t) => FILLER_TAIL.test(String(t || '').trim());
/** CJK punctuation leaked by the model ("…in Uttarakhand。") → normal sentence marks. */
export const westernPunct = (s) => String(s || '').replace(/[​-‍﻿]/g, '').replace(/。/g, '.').replace(/！/g, '!').replace(/？/g, '?').replace(/，/g, ',').replace(/：/g, ':');

/**
 * One clean sentence end: strips leaked JSON quotes/commas and doubled marks ("…है।”,।", "किया! ?") and leaves a
 * single mark — ? or ! when the line had one, otherwise । (Devanagari) or "." (Latin).
 */
export function cleanEnd(t, deva = true) {
  // "|" and "॥" are written as a danda by the model ("…धांसू है, समझे? |।")
  const s = String(t || '').trim(), m = s.match(/[\s।॥|.!?"“”'’,;:]+$/);
  const tail = m ? m[0] : '', body = s.slice(0, s.length - tail.length).trimEnd();
  if (!body) return s;
  const mark = (tail.match(/[?!]/) || [deva ? '।' : '.'])[0];
  return body + mark;
}

// ── script quality ────────────────────────────────────────────────────────────────────────────────────────────
const digitsOf = (s) => (String(s || '').replace(/(\d),(\d)/g, '$1$2').match(/\d+(?:\.\d+)?/g) || []);
/** Keep "onScreen" only when it repeats what the same line says: its numbers, or at least one of its words. */
export function onScreenFor(l) {
  if (!l.onScreen) return l;
  const said = `${l.text} ${l.say || ''}`, saidDigits = digitsOf(said);
  const nums = digitsOf(l.onScreen);
  const ok = nums.length ? nums.every((d) => saidDigits.includes(d)) : String(l.onScreen).split(/[\s,.:;!?।|/–-]+/).filter((w) => [...w].length >= 3).some((w) => said.includes(w));
  if (ok) return l;
  const { onScreen, ...rest } = l; return rest;
}

/** Deterministic quality checks sent back to the model as fixable problems (they never discard a valid script). */
export function qualityProblems(script, config) {
  const out = [], deva = config.language.script === 'Deva' || config.language.id === 'hinglish';
  const hindiVisual = script.lines.map((l, i) => (/[ऀ-ॿ]/.test(l.visual) ? i + 1 : 0)).filter(Boolean);
  if (deva && hindiVisual.length) out.push(`"visual" must be one English sentence in Latin letters (it is used to choose the picture), but lines ${hindiVisual.join(', ')} wrote it in Hindi`);
  const noVisual = script.lines.map((l, i) => (!String(l.visual || '').trim() ? i + 1 : 0)).filter(Boolean);
  if (noVisual.length) out.push(`lines ${noVisual.join(', ')} have no "visual"`);
  const frag = script.lines.map((l, i) => (countWords(l.say || l.text) < 4 ? i + 1 : 0)).filter(Boolean);
  if (frag.length) out.push(`lines ${frag.join(', ')} are fragments: make every line a complete sentence that continues the story`);
  const dangle = script.lines.map((l, i) => (danglingLine(l.say || l.text) ? i + 1 : 0)).filter(Boolean);
  const filler = script.lines.map((l, i) => (fillerTail(l.say || l.text) ? i + 1 : 0)).filter(Boolean);
  if (filler.length) out.push(`lines ${filler.join(', ')} end with a filler word added after a comma (like "sadly", "then", "surely", "indeed"): remove it and end the sentence naturally`);
  if (dangle.length) out.push(`lines ${dangle.join(', ')} end with a connecting word or a comma: end every line as a complete sentence (। ? !) and put connecting words at the START of the next sentence`);
  // the same opening on most lines reads as a list, not a story ("24 सितंबर को…", "फिर…", "फिर…")
  const starts = script.lines.map((l) => String(l.text).trim().split(/\s+/)[0]); const top = Math.max(0, ...Object.values(starts.reduce((a, w) => ((a[w] = (a[w] || 0) + 1), a), {})));
  if (script.lines.length >= 6 && top > script.lines.length / 3) out.push('too many lines start with the same word: vary the sentences so they read as one flowing story');
  return out;
}

/**
 * Editor pass for Devanagari scripts: the 4B model writes better Hindi when it edits a draft than when it composes
 * (draft at temperature 0.6–0.75, edit at 0.2). The edit is accepted only if it keeps the line count, every number of
 * every line, the length (±15 %), the language rules and does not add fact problems; otherwise the draft is kept.
 */
async function polishScript(config, value, { topicFacts, facts, signal, onProgress = () => {} } = {}) {
  if (config.language.script !== 'Deva') return value;
  const src = value.script, n = src.lines.length;
  try {
    onProgress({ indeterminate: true, message: 'Proofreading the Hindi script (grammar, spelling, flow)' });
    const sys = [
      `You are a careful native ${config.language.name} editor for spoken YouTube Shorts narration. Output ONLY JSON matching the schema.`,
      `You get a numbered draft of ${n} lines that is read aloud as one continuous story. Return exactly ${n} edited lines, in the same order, line i replacing line i.`,
      'Fix: misspelled or invented words, wrong grammar, wrong gender/number agreement, awkward literal translations and half-sentences. Where two lines feel disconnected you may START a line with a short connecting word (फिर, लेकिन, इसलिए), but every line must stay one complete sentence on its own.',
      'Every line must END with । or ? or ! — never with a comma or a connecting word (तो, फिर, और, इससे).',
      'Keep: the meaning and the facts of every line, every number, year, date and name exactly as written (same digits), the narrator\'s tone, and roughly the same length per line. Do not add new facts. Devanagari only, no Latin letters. End every line with । or ? or !.',
    ].join('\n');
    const user = `Topic: ${config.topic}\nDraft:\n${src.lines.map((l, i) => `${i + 1}. ${l.text}`).join('\n')}`;
    const schema = { type: 'object', properties: { lines: { type: 'array', items: { type: 'string' }, minItems: n, maxItems: n } }, required: ['lines'], additionalProperties: false };
    const { text } = await chat({ messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], schema, temperature: 0.2, maxTokens: Math.round(src.lines.reduce((a, l) => a + l.text.length, 0) * 1.6) + 300, signal });
    let out; try { out = JSON.parse(text).lines; } catch { return note(value, 'editor output was not valid JSON'); }
    if (!Array.isArray(out) || out.length !== n) return note(value, 'editor changed the number of lines');
    const lines = src.lines.map((l, i) => ({ ...l, text: cleanEnd(devanagarizeLatin(String(out[i] || '').replace(/^\s*\d+[.)]\s*/, '').trim()), true) }));
    const script = { title: src.title, lines };
    const reasons = [];
    lines.forEach((l, i) => { if (digitsOf(l.text).sort().join() !== digitsOf(src.lines[i].text).sort().join()) reasons.push(`line ${i + 1} numbers changed`); if (!l.text) reasons.push(`line ${i + 1} empty`); if (!/[।?!]["'”’)]*$/.test(l.text) || danglingLine(l.text)) reasons.push(`line ${i + 1} is not a complete sentence`); });
    if (checkLanguage(script, config).length || lines.some((l) => latinWords(l.text).length)) reasons.push('language check failed');
    const before = estimateSeconds(src, config), after = estimateSeconds(script, config);
    // the edit must not drift the length: within 10 % of the draft AND within the target window (±10 %)
    const fit = after.speechSeconds / Math.max(1, after.targetSpeech), fitBefore = before.speechSeconds / Math.max(1, before.targetSpeech);
    if (after.speechSeconds < before.speechSeconds * 0.9 || after.speechSeconds > before.speechSeconds * 1.1) reasons.push(`length changed (${before.speechSeconds}s → ${after.speechSeconds}s)`);
    else if ((fit < 0.9 || fit > 1.1) && Math.abs(fit - 1) > Math.abs(fitBefore - 1)) reasons.push(`edit moves the length away from the ${config.durationSeconds} s target`);
    const review = reviewClaims(script, { topic: config.topic, topicFacts, userFacts: facts });
    const badCount = (r) => r.claims.filter((c) => c.status === 'contradicted' || c.status === 'needs-attribution').length;
    if (badCount(review) > badCount(value.meta.claimReview) || review.summary.needsReview > value.meta.claimReview.summary.needsReview) reasons.push('editor introduced fact problems');
    if (reasons.length) return note(value, reasons.slice(0, 4).join('; '));
    const changed = lines.filter((l, i) => l.text !== src.lines[i].text).length;
    onProgress({ message: `Proofread: ${changed} of ${n} lines improved` });
    return { script: { ...script, lines: lines.map(onScreenFor) }, meta: { ...value.meta, claimReview: review, claimsToVerify: extractClaims(script), wordCount: after.words, estimatedSeconds: after.seconds, polish: { applied: true, changedLines: changed, draft: src.lines.map((l) => l.text) } } };
  } catch (e) {
    if (signal?.aborted) throw e;
    return note(value, `editor failed: ${e.message.slice(0, 120)}`);
  }
  function note(v, why) { onProgress({ message: `Proofreading skipped (${why}); keeping the draft` }); return { ...v, meta: { ...v.meta, polish: { applied: false, reason: why } } }; }
}

/**
 * @param config  validated generation config
 * @param onProgress ({ current, total, message }) — tokens generated so far vs the expected token count
 */
/**
 * Local-model review before approval: the model re-reads the finished script and judges every line (grammar,
 * spelling, real words, complete sentence, natural phrasing, follows the previous line). A flagged line is replaced
 * by the model's correction only when the correction keeps the line's numbers, the language rules, a complete
 * sentence, the length (±10 % overall) and adds no fact problems — meaning and facts never change. Up to 3 rounds;
 * meta.llmReview = { confirmed, rounds, changedLines, issues } — the render is blocked until confirmed or the user
 * approves the reported issues in Script Studio.
 */
async function reviewScript(config, value, { signal, onProgress = () => {}, facts = null } = {}) {
  const topicFacts = findTopicFacts(config.topic), deva = config.language.script === 'Deva';
  let cur = value, changed = 0, issues = [], rounds = 0;
  const en = value.meta.englishDraft?.lines?.length === value.script.lines.length ? value.meta.englishDraft.lines : null;
  const schema = { type: 'object', properties: { lines: { type: 'array', minItems: cur.script.lines.length, maxItems: cur.script.lines.length, items: { type: 'object', properties: { ok: { type: 'boolean' }, problem: { type: 'string', maxLength: 160 }, corrected: { type: 'string', maxLength: 300 } }, required: ['ok', 'problem', 'corrected'], additionalProperties: false } } }, required: ['lines'], additionalProperties: false };
  try {
    for (rounds = 1; rounds <= 3; rounds++) {
      onProgress({ indeterminate: true, message: `Local model is proof-reading the script (round ${rounds})` });
      const src = cur.script.lines;
      const sys = [
        `You are a strict native ${config.language.name} proof-reader for narration that will be read aloud. Output ONLY JSON matching the schema, one entry per line, in order.`,
        'For each line decide ok=true only if it is grammatically correct, every word is a real correctly spelled word, it is one complete natural sentence a native speaker would say, and it follows sensibly from the previous line.',
        'If ok=false: "problem" names the exact mistake in a few words, and "corrected" is the same line fixed — same meaning, same facts, every number/year/name unchanged, about the same length. If ok=true, "problem" and "corrected" are empty strings.',
        deva ? 'Write corrections in Devanagari only. End each line with । or ? or !.' : 'End each line with a full stop, ? or !.',
        ...(deva ? ['HINDI EDITING (set ok=false for any of these): unnatural word order — spoken Hindi puts the verb at the END ("सड़क सालों तक बनी रही", never "सड़क बनी रही सालों"); a verb, adjective or postposition that does not agree in gender and number with its noun; a pronoun that switches for the same thing; a word-for-word English construction; a sentence that is hard to say aloud. The correction is how a professional Hindi storyteller would say it.'] : []),
        // a real but wrong word ("चुनौतियाँ" = challenges where the story means घंटियाँ = bells) passes a grammar check;
        // with the English source each line must also MEAN what its source says
        ...(en ? ['Each line is a translation of the English source shown in [brackets]. Set ok=false if any word changes the meaning (a different object, person, place, number or claim than the source), and correct it to match the source.'] : []),
        'STORY: also set ok=false when a line repeats information already given in an earlier line, does not serve the central story of the topic (an aside such as where an organisation is headquartered), when line 1 is an EMPTY opener that names nothing specific (listen / one minute / today we talk about / सुनो / एक मिनट / a bare "क्या आप जानते हैं?") — a curiosity question that names the specific idea of the topic ("क्या आप जानते हैं कि चाँद हमें हमेशा एक ही चेहरा क्यों दिखाता है?") is GOOD and must be kept, or when the last line is a generic ending (amazing / proud moment / गर्व की बात / कमाल है). The correction must move the story forward or end it with a real takeaway.',
        'A belief, legend or tradition must be framed as one ("माना जाता है", "it is believed"); set ok=false if such a claim is stated as scientific fact.',
      ].join('\n');
      const { text } = await chat({ messages: [{ role: 'system', content: sys }, { role: 'user', content: `Topic: ${config.topic}\n${src.map((l, i) => `${i + 1}. ${l.text}${en && en[i] ? `  [${en[i]}]` : ''}`).join('\n')}` }], schema, temperature: 0.1, maxTokens: Math.round(src.reduce((a, l) => a + l.text.length, 0) * 2) + 600, signal });
      let verdict; try { verdict = JSON.parse(text).lines; } catch { issues = [{ line: 0, problem: 'reviewer output was not valid JSON' }]; continue; }
      const flagged = verdict.map((v, i) => ({ ...v, i })).filter((v) => !v.ok);
      if (!flagged.length) { issues = []; break; }
      issues = flagged.map((v) => ({ line: v.i + 1, problem: String(v.problem || '').slice(0, 160), text: src[v.i].text }));
      // apply each correction only if it passes the guards; otherwise the issue stays for the user
      const lines = src.map((l) => ({ ...l })); let applied = 0;
      for (const v of flagged) {
        let fix = String(v.corrected || '').replace(/^\s*\d+[.)]\s+/, '').trim(); if (!fix) continue;
        fix = deva ? cleanEnd(devanagarizeLatin(asciiDigits(westernPunct(fix))), true) : westernPunct(fix);
        // a correction may drop numbers (an irrelevant aside) but never introduce a number the script does not already contain
        const old = src[v.i].text, known = new Set(src.flatMap((l) => digitsOf(l.text)));
        if (fix === old || digitsOf(fix).some((x) => !known.has(x)) || danglingLine(fix) || fillerTail(fix) || (deva && latinWords(fix).length)) continue;
        if (checkLanguage({ lines: [{ ...lines[v.i], text: fix }] }, config).length) continue;
        lines[v.i].text = fix; lines[v.i] = onScreenFor(lines[v.i]); applied++;
      }
      if (!applied) break;
      const script = { title: cur.script.title, lines }, before = estimateSeconds(cur.script, config), after = estimateSeconds(script, config);
      const review = reviewClaims(script, { topic: config.topic, topicFacts, userFacts: facts });
      const bad = (r) => r.claims.filter((c) => c.status === 'contradicted' || c.status === 'needs-attribution').length;
      if (Math.abs(after.speechSeconds - before.speechSeconds) > before.speechSeconds * 0.1 || bad(review) > bad(cur.meta.claimReview)) break;   // keep the previous version
      changed += applied;
      cur = { script, meta: { ...cur.meta, claimReview: review, claimsToVerify: extractClaims(script), wordCount: after.words, estimatedSeconds: after.seconds } };
    }
  } catch (e) { if (signal?.aborted) throw e; issues = [{ line: 0, problem: `review could not run: ${String(e.message).slice(0, 120)}` }]; }
  // the model's verdict never overrides the deterministic story and fact checks
  const modelIssues = issues.filter((x) => x.line > 0 || /could not run|not valid JSON/.test(x.problem));
  for (const p of qualityProblems(cur.script, config)) issues.push({ line: +(p.match(/lines? (\d+)/)?.[1] || 0), problem: p });
  for (const p of storyProblems(cur.script)) issues.push({ line: +(p.match(/^lines? (\d+)/)?.[1] || 0), problem: p });
  for (const c of (cur.meta.claimReview?.claims || []).filter((x) => x.status === 'needs-attribution' || x.status === 'contradicted')) issues.push({ line: c.line, problem: c.status === 'contradicted' ? `known error: ${String(c.note || '').slice(0, 120)}` : 'belief or legend stated as fact — frame it ("माना जाता है" / "it is believed")' });
  // separate gates: language, facts (incl. "needs research"), topic coverage, narrative, duration, editorial.
  // "Ready" needs every gate; a failed fact or language gate is never averaged away by the others.
  onProgress({ indeterminate: true, message: 'Local model is judging the whole script (hook, flow, ending)' });
  let judgedNow = await judgeScript(config, cur, { signal });
  // one bounded rewrite of only the hook and/or ending when the editor says they are weak (kept only if better)
  // the model judgment is ADVISORY: it never triggers or approves a change. Only deterministic problems (an empty
  // opener, a stock ending) start the bounded hook/ending rewrite, which is accepted on deterministic checks only.
  const sp = storyProblems(cur.script);
  const det = { hook: sp.some((p) => /^line 1 is a generic/.test(p)) ? 'generic' : 'strong', ending: sp.some((p) => /generic ending/.test(p)) ? 'generic' : 'payoff', flow: 'connected',
    hookNote: sp.find((p) => /^line 1 is a generic/.test(p)) || '', endingNote: sp.find((p) => /generic ending/.test(p)) || '' };
  if (det.hook !== 'strong' || det.ending !== 'payoff') {
    onProgress({ indeterminate: true, message: 'Local model is rewriting the opening and closing lines' });
    ({ value: cur } = await improveHookEnding(config, cur, det, { signal }));
  }
  cur = { ...cur, meta: { ...cur.meta, editorialJudgment: judgedNow } };
  const gates = qualityGates(config, cur, modelIssues);
  const status = readiness(gates);
  cur = { ...cur, meta: { ...cur.meta, status, gateGroups: gateGroups(gates), claims: claimLedger(cur, topicFacts, facts) } };
  for (const [name, gt] of Object.entries(gates)) if (!gt.ok && (name === 'facts' || name === 'coverage' || name === 'duration')) for (const p of gt.issues) if (!issues.some((x) => x.problem === p)) issues.push({ line: +(p.match(/^line (\d+)/)?.[1] || 0), problem: `${name}: ${p}` });
  const confirmed = status === 'READY';
  onProgress({ message: confirmed ? `Local model confirmed the script (${rounds} round${rounds > 1 ? 's' : ''}, ${changed} line${changed === 1 ? '' : 's'} corrected)` : `Local model still flags ${issues.length} line(s): review them in Script Studio` });
  return { ...cur, meta: { ...cur.meta, gates, llmReview: { confirmed, gates: Object.fromEntries(Object.entries(gates).map(([k, v]) => [k, v.ok])), rounds: Math.min(rounds, 3), changedLines: changed, issues, modelIssues, reviewedAt: new Date().toISOString() } } };
}

/**
 * Gates are (re)computed on the FINAL script — after the visual pass rewrote every visual. Before this, the visuals
 * gate judged the draft visuals and the grounding list came from an earlier draft (both seen stale in Script Studio).
 */
export function finalizeGates(config, value, { topicFacts = findTopicFacts(config.topic), facts = null } = {}) {
  const r = value.meta.llmReview || {};
  const gates = qualityGates(config, value, r.modelIssues || []);
  const status = readiness(gates), confirmed = status === 'READY';
  const keep = (r.issues || []).filter((x) => !/^(facts|coverage|duration|visuals): /.test(x.problem));
  const gateIssues = Object.entries(gates).filter(([n, g]) => !g.ok && ['facts', 'coverage', 'duration', 'visuals'].includes(n)).flatMap(([n, g]) => g.issues.map((p) => ({ line: +(p.match(/^line (\d+)/)?.[1] || 0), problem: `${n}: ${p}` })));
  return { ...value, meta: { ...value.meta, gates, status, gateGroups: gateGroups(gates), claims: claimLedger(value, topicFacts, facts),
    llmReview: { ...r, confirmed, gates: Object.fromEntries(Object.entries(gates).map(([k, v]) => [k, v.ok])), issues: [...keep, ...gateIssues] } } };
}

export async function generateScript(config, opts = {}) {
  const r = await fitLength(config, await generateCore(config, opts), opts);
  const reviewed = await reviewScript(config, r, opts);
  // the proof-read and hook/ending rewrite may change line lengths: fit once more on the reviewed text
  const refit = await fitLength(config, reviewed, { ...opts, stage: 'after review' });
  const visual = await describeVisuals(config, refit, opts);
  return finalizeGates(config, visual, { facts: opts.facts || null });
}

// ── Stage E: visuals from the FINAL narration (after translation and review), one shot per line ──────────────────
/**
 * The draft's visuals were written together with an earlier version of each line; once the line is translated or
 * corrected they can drift. This pass rewrites every "visual" from the final text: subject, action, environment,
 * objects and camera, composed into one English sentence. On failure the existing visuals are kept.
 */
export async function describeVisuals(config, value, { signal, onProgress = () => {} } = {}) {
  const lines = value.script.lines, en = value.meta.englishDraft?.lines?.length === lines.length ? value.meta.englishDraft.lines : null;
  const schema = { type: 'object', properties: { shots: { type: 'array', minItems: lines.length, maxItems: lines.length, items: { type: 'object', properties: {
    visual: { type: 'string', maxLength: 200 }, subject: { type: 'string', maxLength: 80 }, action: { type: 'string', maxLength: 80 }, environment: { type: 'string', maxLength: 80 },
    objects: { type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: 4 }, camera: { type: 'string', maxLength: 40 } },
    required: ['visual', 'subject', 'action', 'environment', 'objects', 'camera'], additionalProperties: false } } }, required: ['shots'], additionalProperties: false };
  const sys = [
    'You are a storyboard artist for a vertical YouTube Short. For EACH narration line, in order, describe the one picture that shows exactly what THAT line says. Output ONLY JSON matching the schema, in English (Latin letters only).',
    '"visual" = ONE clean, natural English sentence a director would write, starting with the shot type, e.g. "Wide shot of a camel caravan on a dusty road at sunset, travellers resting at a stone rest house." Then the parts: "subject" = the concrete person, object, animal or place the line is about (by name when the line names it); "action" = what it is doing or what is happening; "environment" = where and when; "objects" = up to 4 visible things that support the line; "camera" = shot type (close-up, wide shot, aerial view, low angle…).',
    'Show the line\'s own subject, never an onlooker: no boy, girl, family or crowd gazing at something unless the line is about those people. Keep the science and history right (the correct bodies, orbits, places, equipment and era for that line — never a detail the line contradicts). Stay with the topic and the period of the line (no modern objects in a historical line). Never describe text, captions, numbers on screen, charts, diagrams, arrows, overlays, cross-sections or logos — always a real, photographable scene. A number or abstract idea is shown through a concrete scene (a crowd, a machine, a map, a landscape).',
  ].join('\n');
  const user = `Topic: ${config.topic}\n${lines.map((l, i) => `${i + 1}. ${l.text}${en && en[i] ? `  [English: ${en[i]}]` : ''}`).join('\n')}`;
  try {
    onProgress({ indeterminate: true, message: 'Local model is matching a visual to every final line' });
    const { text } = await chat({ messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], schema, temperature: 0.2, maxTokens: 200 + lines.length * 110, signal });
    const shots = JSON.parse(text).shots;
    if (!Array.isArray(shots) || shots.length !== lines.length) return value;
    const latin = visualText;
    const out = lines.map((l, i) => {
      const s = shots[i]; const objs = (s.objects || []).map(latin).filter(Boolean);
      const part = (x) => latin(x).replace(/[.;]+$/, '').replace(/^(\p{Lu})(\p{Ll})/u, (m, a, b) => a.toLowerCase() + b);
      const cam = part(s.camera);
      const v = `${cam ? cam.replace(/^./, (c) => c.toUpperCase()) + ' of ' : ''}${latin(s.subject).replace(/[.;]+$/, "")} ${part(s.action)}, ${part(s.environment)}${objs.length ? `, with ${objs.map(part).join(', ')}` : ''}`.replace(/\s+,/g, ',').replace(/,\s*,/g, ',').slice(0, 218) + '.';
      const best = chooseVisual(s.visual, v);
      return countWords(best) >= 4 && latin(s.subject) ? { ...l, visual: best } : l;
    }).map((l, i, a) => (i && l.visual === a[i - 1].visual && lines[i].visual !== l.visual ? { ...l, visual: lines[i].visual } : l));
    return { script: { ...value.script, lines: out }, meta: { ...value.meta, visuals: { from: 'final narration', shots: shots.map((s) => ({ subject: latin(s.subject), action: latin(s.action), environment: latin(s.environment), objects: (s.objects || []).map(latin), camera: latin(s.camera) })) } } };
  } catch (e) { if (signal?.aborted) throw e; return value; }
}

async function generateCore(config, opts = {}) {
  // History: Hindi used to be written in English first and translated line by line (Gemma 3 4B composed Hindi poorly
  // without a plan). CHANGED (native generation): every language is now written directly in that language from the SAME shared
  // foundation — research (verified facts + essentials) and the story plan (one beat per line, each beat linked to
  // its facts). The English-first translation produced translated-sounding Hindi, left names in Latin letters and
  // dropped "scientists think" framing. Translation is no longer part of the primary pipeline; it exists only as the
  // explicitly requested, labelled `generateTranslated()` below and is validated on its own.
  return generateDirect(config, opts);
}

// Devanagari digits (२०१३) slip past every number check, which reads 0-9 ("८ साल" was not flagged); the voice reads both
const DEVA_DIGITS = '०१२३४५६७८९';
export const asciiDigits = (s) => String(s || '').replace(/[०-९]/g, (d) => String(DEVA_DIGITS.indexOf(d)));

/**
 * OPTIONAL, explicitly requested translation (never used by generateScript): an English script translated into the
 * target language, labelled meta.translated = true and run through the same review/gates as a native script.
 */
export async function generateTranslated(config, opts = {}) {
  const r = await viaEnglish(config, opts);
  const out = await reviewScript(config, await fitLength(config, { ...r, meta: { ...r.meta, translated: true, generationMode: 'translated from English' } }, opts), opts);
  return finalizeGates(config, await describeVisuals(config, out, opts), { facts: opts.facts || null });
}

async function viaEnglish(config, { onProgress = () => {}, signal, facts = null } = {}) {
  const en = LANGUAGES.find((l) => l.id === 'en');
  // Hindi runs ~15 % longer than the English it is translated from (measured on two drafts: 45.8 s for 40 s, 51 s
  // for 45 s), so the English draft is written for 87 % of the target; the Hindi length check still applies after
  const enConfig = { ...config, durationSeconds: Math.max(15, Math.round(config.durationSeconds * 0.87)), language: { id: en.id, code: en.code, name: en.name, script: en.script, dialect: en.dialect, locale: en.locale, captionScript: en.captionScript, ttsScript: en.ttsScript } };
  const draft = await generateDirect(enConfig, { signal, facts, onProgress: (p) => onProgress({ ...p, ...(p.message ? { message: `English draft — ${p.message}` } : {}) }) });
  const cat = getCatalog(), lang = cat.languages.find((l) => l.id === config.language.id), pers = cat.personalities.find((p) => p.id === config.narration.personality);
  const src = draft.script.lines, n = src.length, topicFacts = findTopicFacts(config.topic);
  const sys = [
    `You translate narration for vertical YouTube Shorts into ${lang.name}. ${lang.writing}`,
    `NARRATOR PERSONALITY: ${pers.name}. ${pers.voice}`,
    `Translate the ${n} numbered English lines into exactly ${n} lines, line i for line i, the way a native speaker would SAY them aloud: natural, conversational, correct grammar and gender agreement, only real common words. Translate the meaning, not word by word.`,
    'Keep every number and year as digits 0-9 exactly as in the English line (same digits). Keep "million"/"billion" as मिलियन/बिलियन with the same number; keep "crore"/"lakh" as करोड़/लाख. Do not add or drop facts.',
    'Names are never translated, only written phonetically in Devanagari: people, places, organisations and the titles of films, books and missions (a film called "Gravity" → ग्रेविटी, not गुरुत्वाकर्षण).',
    'Each line is one complete sentence that ends with । or ? or !. The title is a short catchy title in the same language. Output ONLY JSON matching the schema.',
  ].join('\n');
  const chars = src.reduce((a, l) => a + l.text.length, 0);
  const schema = { type: 'object', properties: { title: { type: 'string', maxLength: 80 }, lines: { type: 'array', items: { type: 'string', maxLength: Math.round(Math.max(...src.map((l) => l.text.length)) * 1.8) + 40 }, minItems: n, maxItems: n } }, required: ['title', 'lines'], additionalProperties: false };
  let messages = [{ role: 'system', content: sys }, { role: 'user', content: `Title: ${draft.script.title}\n${src.map((l, i) => `${i + 1}. ${l.text}`).join('\n')}` }];
  let best = null, last = '';
  for (let attempt = 1; attempt <= 4; attempt++) {
    onProgress({ indeterminate: true, message: `Translating the English draft into ${lang.name} (attempt ${attempt})` });
    const { text } = await chat({ messages, schema, temperature: attempt === 1 ? 0.3 : 0.45, maxTokens: Math.round(chars * 1.4) + 400, signal });
    let out; try { out = JSON.parse(text); } catch { last = 'not valid JSON'; messages = [...messages, { role: 'assistant', content: text.slice(0, 2000) }, { role: 'user', content: 'That was not valid JSON. Output only the JSON object.' }]; continue; }
    // names the translation left in Latin ("Uttarapath", "Rudyard Kipling") are spelled in Devanagari; English glosses in
    // brackets ("सराई (rest houses)") are dropped — one leftover name used to fail the whole Hindi script
    const deLatin = (t) => devanagarizeLatin(t).replace(/\s*[(\[][^)\]ऀ-ॿ]*[A-Za-z][^)\]ऀ-ॿ]*[)\]]/g, '').replace(/[‘’'"“”]([A-Za-z][A-Za-z\s-]*)[‘’'"“”]/g, '$1').replace(/[A-Za-z]{2,}(?:-[A-Za-z]+)*/g, (w) => w.split('-').map(phoneticDeva).join('-'));
    const lines = src.map((l, i) => onScreenFor({ text: cleanEnd(deLatin(asciiDigits(westernPunct(out.lines?.[i] || '').replace(/^\s*\d+[.)]\s+/, '').trim())), true), visual: l.visual, ...(l.onScreen ? { onScreen: l.onScreen } : {}) }));
    const script = { title: asciiDigits(String(out.title || draft.script.title)).trim(), lines };
    const problems = [...checkLanguage(script, config), ...qualityProblems(script, config)];
    const stray = [...new Set(lines.flatMap((l) => latinWords(l.text)))];
    if (stray.length) problems.push(`write these words in Devanagari or use Hindi words: ${stray.slice(0, 10).join(', ')}`);
    // a number spelled out as a word ("7" → "सात") is fine; a digit that is new or changed would be an invented fact
    // million/billion ↔ crore/lakh conversions are equivalent ("$100 million" → "10 करोड़ डॉलर"): ×10, ×100 and inverses
    const same = (d, w) => [1, 10, 100, 0.1, 0.01].some((k) => Math.abs(+d - +w * k) < 1e-9);
    lines.forEach((l, i) => { const want = digitsOf(src[i].text), extra = digitsOf(l.text).filter((d) => !want.some((w) => same(d, w))); if (extra.length) problems.push(`line ${i + 1} has numbers that are not in the English line (${extra.join(', ')}); keep exactly ${want.join(', ') || 'no numbers'}`); });
    // attribution must survive translation: "scientists think the river shifted" must not become "नदी का रास्ता बदल गया"
    lines.forEach((l, i) => { if (EN_HEDGE.test(src[i].text) && !HI_HEDGE.test(l.text)) problems.push(`line ${i + 1} dropped the uncertainty of the English line ("${(src[i].text.match(EN_HEDGE) || [''])[0]}"): keep it, e.g. "माना जाता है", "वैज्ञानिकों का मानना है", "शायद", "हो सकता है"`); });
    const est = estimateSeconds(script, config), off = est.speechSeconds / Math.max(1, est.targetSpeech);
    if (off < 0.9) problems.push(`the translation is too short (${est.seconds} s for ${config.durationSeconds} s): use fuller, natural sentences`);
    if (off > 1.1) problems.push(`the translation is too long (${est.seconds} s for ${config.durationSeconds} s): use shorter, simpler wording`);
    const review = reviewClaims(script, { topic: config.topic, topicFacts, userFacts: facts });
    const lengthOnly = problems.length && problems.every((p) => /too (short|long)/.test(p)) && off >= 0.75 && off <= 1.4;   // fitLength() follows   // what TTS speed control can still absorb (1.25 failed at narration: 44.1 s for 40 s)
    const draftFlags = (draft.meta.claimReview?.claims || []).filter((c) => c.status === 'needs-attribution' || c.status === 'contradicted').map((c) => ({ line: c.line, status: c.status, value: c.value, note: c.note, fromDraft: true }));
    const value = { script, meta: { ...draft.meta, draftFlags, viaEnglish: true, englishDraft: { title: draft.script.title, lines: src.map((l) => l.text) }, translationAttempts: attempt, claimReview: review, claimsToVerify: extractClaims(script), wordCount: est.words, estimatedSeconds: est.seconds, lineCount: n } };
    if (!problems.length) return polishScript(config, value, { topicFacts, facts, signal, onProgress });
    if (lengthOnly && (!best || Math.abs(off - 1) < best.dev)) best = { value, dev: Math.abs(off - 1) };
    last = problems.join('; ');
    messages = [...messages, { role: 'assistant', content: text.slice(0, 4000) }, { role: 'user', content: `Fix these problems and output the full corrected JSON: ${last}.` }];
  }
  if (best) return polishScript(config, best.value, { topicFacts, facts, signal, onProgress });
  throw new Error(`translation failed: ${last.slice(0, 200)}`);
}

async function generateDirect(config, { onProgress = () => {}, signal, facts = null } = {}) {
  await ensureServer((m) => onProgress({ indeterminate: true, message: m }));
  const n = lineCount(config), budget = wordBudget(config, n);
  const tokensPerWord = config.language.code === 'hi' ? (config.language.id === 'hinglish' ? 9 : 4.5) : 2.6;   // Hinglish: Devanagari say-form + Roman text + English list per line
  const expected = Math.round(budget * tokensPerWord + n * 22 + 40);
  const topicFacts = findTopicFacts(config.topic);
  // Stage A+B: plan the story first (one beat per line); Stage C writes from the plan
  onProgress({ indeterminate: true, message: 'Planning the story (central story, hook, order of facts, ending)' });
  // Stage A: coverage checklist + claims, each mapped to a source; claims from the model's own memory are self-checked
  // and kept only when judged true (they stay marked "needs research" — never treated as verified evidence)
  onProgress({ indeterminate: true, message: 'Researching the topic (essential facts, people, events; checking claims)' });
  const research = await researchTopic(config, { facts, topicFacts, signal });
  const plan = await planStory(config, n, { facts, topicFacts, research, signal });
  // names (asked of the model) + established technical terms from the fact file ("terms": { "tidal locking": "…" })
  const names = config.language.code === 'hi' ? { ...(await topicNameSpellings(research, config.topic, { signal })), ...(topicFacts?.terms?.hi || {}) } : {};
  let messages = prompt(config, n, budget, facts, topicFacts, plan, names), last = null, attempts = 0, review = null, best = null, tokenBoost = 1;
  const diagnostics = [];
  for (attempts = 1; attempts <= 5; attempts++) {
    // Hindi at 0.75 produced invented words ("जहंके", "सूनो"); a cooler first attempt keeps the wording real
    const t1 = config.language.code === 'hi' ? 0.7 : 0.75;
    const { text, tokens, truncated, finishReason } = await chat({ messages, schema: schemaFor(config, n, Math.round(budget / n) + 7), temperature: attempts === 1 ? t1 : 0.45, maxTokens: Math.round(expected * (attempts === 1 ? 1.8 : 2.6) * tokenBoost) + 300,   // retries carry feedback; truncated JSON was seen on Hindi retries signal,
      onToken: (k) => { if (k % 8 === 0) onProgress({ current: Math.min(k, expected), total: expected, message: `Writing script (attempt ${attempts}): ${k} tokens` }); } });
    diagnostics.push({ attempt: attempts, finishReason, tokens, chars: text.length, raw: text.slice(0, 6000) });
    // truncated output (max_tokens reached) is never parsed or fed back: retry with a larger budget (seen: Hinglish,
    // whose Devanagari say-forms + English lists + visuals cost ~2× the tokens, "not valid JSON" on every retry)
    if (truncated) { tokenBoost = Math.min(3, tokenBoost * 1.6); last = `model output was cut off at ${tokens} tokens (attempt ${attempts})`; continue; }
    const script = parseJsonStrict(text);
    if (!script || !Array.isArray(script.lines) || !script.lines.length || script.lines.some((l) => typeof l?.text !== 'string')) { last = `model output was not valid, complete JSON (attempt ${attempts}, finish: ${finishReason || 'unknown'})`; continue; }
    const raw = (script.lines || []).filter((l) => String(l.text || '').trim());
    script.lines = (script.lines || []).map((l) => ({ text: westernPunct(String(l.text || '').trim()), ...(l.say ? { say: westernPunct(String(l.say).trim()) } : {}), visual: String(l.visual || '').trim(), ...(l.onScreen && String(l.onScreen).trim() && !/^\s*(none|null|n\/?a|nil|nothing|-+|—|empty|no text|कुछ नहीं|कोई नहीं)?\s*$/i.test(String(l.onScreen)) ? { onScreen: String(l.onScreen).trim() } : {}) })).filter((l) => l.text);
    // English hints are pooled across the script, so a word is spelled the same on every line even where the model
    // forgot to list it (seen: "Octopus" on lines 1–4, "oktopas" on line 5)
    const allEnglish = [...new Set(raw.flatMap((r) => (Array.isArray(r?.english) ? r.english : [])).map(String))];
    if (config.language.id === 'hinglish') script.lines = script.lines.map((l, i) => repairHinglish({ ...l, english: [...new Set([...(Array.isArray(raw[i]?.english) ? raw[i].english : []), ...allEnglish])] }));
    // Hindi: the model sometimes appends a Roman transliteration — "घंटा लटका होता है। (Lagbhag har …)" — strip it
    // …and sometimes leaks other JSON fields into the line ("…हैरान! visual: Wide shot of …"): cut them off
    const stripRoman = (s) => String(s).replace(/\s*\b(?:visual|onScreen|on screen|say|english)\s*:.*$/i, '').replace(/\s*[(\[]\s*[A-Za-z][^)\]ऀ-ॿ]*[)\]]?\s*$/, '').trim();
    if (config.language.script === 'Deva') script.lines = script.lines.map((l) => ({ ...l, text: devanagarizeLatin(/[ऀ-ॿ]/.test(l.text) ? stripRoman(l.text) : l.text) }));
    // native Hindi copies names from the (English) fact list in Latin letters ("Uttarapath", "Rudyard Kipling", even
    // half-mixed "माuryan"): names are always spelled in Devanagari, English glosses in brackets dropped
    if (config.language.script === 'Deva') script.lines = script.lines.map((l) => ({ ...l, text: devaNames(l.text) }));
    const stray = config.language.script === 'Deva' ? [...new Set(script.lines.flatMap((l) => latinWords(l.text)))] : config.language.id === 'hinglish' ? [...new Set(script.lines.flatMap((l) => latinWords(l.say || '')))] : [];
    // every Devanagari line ends as a sentence (the voice pauses and captions break on it)
    if (config.language.script === 'Deva') script.lines = script.lines.map((l) => ({ ...l, text: cleanEnd(asciiDigits(l.text), true), ...(l.onScreen ? { onScreen: asciiDigits(l.onScreen) } : {}) }));
    // on-screen text must repeat something the same line says (seen: "बेंगलुरु" over a line about the payoff)
    // plan text leaked into narration (seen: "…harmless piece. [facts: A vaccine shows …]") and stray brackets ("। [।")
    script.lines = script.lines.map((l) => ({ ...l, text: stripLeaks(l.text), ...(l.say ? { say: stripLeaks(l.say) } : {}) }));
    script.lines = script.lines.map(onScreenFor);
    // from the 3rd attempt a few leftover Latin names ("Tycho") are spelled phonetically instead of failing the script
    if (attempts >= 3 && stray.length && stray.length <= 4) {
      const fix = (s) => String(s).replace(/[A-Za-z]{2,}/g, (w) => (stray.includes(w) ? phoneticDeva(w) : w));
      script.lines = script.lines.map((l) => (config.language.id === 'hinglish' ? { ...l, ...(l.say ? { say: fix(l.say) } : {}) } : { ...l, text: fix(l.text) }));
      stray.length = 0;
    }
    const problems = checkLanguage(script, config);
    if (stray.length) problems.push(`these English words must be written in Devanagari (or replaced by Hindi words): ${stray.slice(0, 12).join(', ')}`);
    const quality = [...qualityProblems(script, config), ...storyProblems(script), ...(config.language.id === 'hinglish' ? hinglishProblems(script) : []),
      ...termProblems(config, script, { beats: plan?.beats?.length === script.lines.length ? plan.beats.map((b) => b.point) : null, topicFacts })];
    const est = estimateSeconds(script, config);
    const off = est.speechSeconds / Math.max(1, est.targetSpeech);   // estimated vs available speech time
    if (off < 0.9) problems.push(`the script is too short (it would last about ${est.seconds} s; ${config.durationSeconds} s are needed: add detail to each line)`);
    if (off > 1.1) problems.push(`the script is too long (it would last about ${est.seconds} s, the target is ${config.durationSeconds} s; about ${Math.round(est.words / off)} words: exactly ${n} lines of about ${Math.round(budget / n)} words, so shorten every line)`);
    // fact review (soft problems): a known error, a legend/theory told as fact, or — when verified facts exist — a
    // number or year they do not contain sends the script back with the correction. Soft problems never cost a valid
    // script: the best language- and length-valid attempt is kept, and if no attempt is fact-clean it is returned
    // with its flagged claims for the user to review (the render stays blocked until they do).
    review = reviewClaims({ title: script.title, lines: script.lines }, { topic: config.topic, topicFacts, userFacts: facts });
    const soft = [...quality];
    const missing = missingEssentials(research, script.lines.map((l) => l.text).join(' '));
    if (missing.length) soft.push(`the script leaves out essential parts of this topic: ${missing.join(', ')} — include them where they belong in the story`);
    // claim-to-source mapping: in English (incl. the draft Hindi is translated from) every name and number must come
    // from the sources (seen: "Akbar ordered…", "'Lagaan' funded…", "12,000 vehicles" — none in any source)
    const allowed = [config.topic, ...(research?.evidence || []).map((e) => e.text), ...(research?.essentials || []), ...(topicFacts?.aliases || [])].join(' ');
    // Hinglish: names arrive in each line's English-word list (Roman captions are not reliably capitalised), numbers in the text
    const groundForm = config.language.id === 'hinglish' ? script.lines.map((l, i) => `x ${(raw[i]?.english || l.english || []).map((w) => String(w)).join(' ')} ${digitsOf(l.text).join(' ')}`   /* original case: only names the model capitalised count; "x" keeps a real name out of the sentence-start slot */) : script.lines.map((l) => l.text);
    const ug = (config.language.id === 'en' || config.language.id === 'hinglish') && research ? ungrounded(groundForm, allowed + ' ' + (config.language.id === 'hinglish' ? COMMON_EN : '')) : [];
    // shared foundation → every language: a line whose planned facts are a theory or legend must keep its framing in
    // THIS language (seen: "नदी का रास्ता बदल गया" for "rivers may have shifted course")
    const unframed = unframedLines(config, script.lines, plan);
    if (unframed.length) soft.push(`lines ${unframed.map((u) => u.line).join(', ')} state a theory or legend as fact: keep the uncertainty (${config.language.script === 'Deva' ? '"माना जाता है", "वैज्ञानिकों का मानना है", "शायद"' : config.language.id === 'hinglish' ? '"maana jaata hai", "scientists ka maanna hai", "shayad"' : '"scientists think", "may have", "legend says"'})`);
    if (ug.length) soft.push(`these names/numbers are not in the facts for this story — remove them or use only the listed facts: ${ug.map((u) => `line ${u.line}: ${u.terms.join(', ')}`).join('; ')}`);
    const bad = review.claims.filter((c) => c.status === 'contradicted' || c.status === 'needs-attribution');
    if (bad.length) soft.push(`fact problems: ${[...new Set(bad.map((c) => `line ${c.line}: ${c.status === 'contradicted' ? `wrong — ${c.note}` : `${c.kind} (${c.note})`}`))].join('; ')}`);
    if (topicFacts || facts) {   // every year and number must come from the verified facts (seen: "found them in 42" for 1942)
      const nums = review.claims.filter((c) => (c.kind === 'year' || c.kind === 'number') && c.status === 'unverified');
      // quote the verified fact that holds the same number, so the model gets the exact correction
      // (seen repeatedly: "Gravity ₹100 crore" while the fact says "about 100 million dollars")
      const factFor = (c) => { const d = (String(c.value).match(/\d[\d,]*/) || [''])[0].replace(/,/g, ''); return d && (topicFacts?.verified || []).map((x) => (typeof x === 'string' ? x : x.text)).find((tx) => tx.replace(/,/g, '').includes(d)); };
      if (nums.length) soft.push(`numbers not in the VERIFIED FACTS (narration or on-screen text): ${nums.map((c) => { const f = factFor(c); return `line ${c.line} "${c.value}"${f ? ` (the verified fact says: "${f}" — use exactly that, with its unit and currency)` : ''}`; }).join(', ')}. Use only numbers and years exactly as the verified facts give them (years in full, e.g. 1942), or leave the number out`);
    }
    const result = () => ({ script: { title: String(script.title || config.topic).trim(), lines: script.lines }, meta: { plan: plan ? { centralStory: plan.centralStory, beats: plan.beats.map((b) => b.point), usedFacts: plan.usedFacts, lineFacts: plan.beats.map((b) => ({ factTexts: b.factTexts || [], factKinds: b.factKinds || [] })) } : null, research, ungrounded: ug, groundText: allowed + ' ' + (config.language.id === 'hinglish' ? COMMON_EN : ''), unframed, generationMode: 'native', generationLog: diagnostics.map(({ attempt, finishReason, tokens, chars }) => ({ attempt, finishReason, tokens, chars })), model: modelInfo(), attempts, tokens, factsProvided: !!facts, factFile: topicFacts?.file || null, claimReview: review, factRetryOpen: soft, claimsToVerify: extractClaims({ lines: script.lines }), transliteratedLines: script.lines.filter((l) => l.transliterated).length, wordBudget: budget, wordCount: est.words, estimatedSeconds: est.seconds, lineCount: script.lines.length } });
    // length is aimed at ±10 %; a script within ±20 % is still usable as a fallback because TTS duration control
    // re-times the narration within the personality's speed range (only the language checks are truly hard)
    // wider window than before: fitLength() shortens/expands line by line afterwards (seen: valid English at 1.33× failed outright)
    const lengthOnly = problems.length > 0 && problems.every((p) => /^the script is too (short|long)/.test(p)) && off >= 0.6 && off <= 1.8;   // fitLength() rescues over-long native scripts (seen: Hinglish 1.6×)
    if (!problems.length || lengthOnly) {
      const score = bad.length * 3 + review.summary.needsReview + (lengthOnly ? 2 : 0) + quality.length * 2;
      if (!best || score < best.score) best = { score, value: result() };
      if (!problems.length && !soft.length) return polishScript(config, best.value, { topicFacts, facts, signal, onProgress });
    }
    problems.push(...soft);
    last = problems.join('; ');
    messages = [...messages, { role: 'assistant', content: text.slice(0, 4000) }, { role: 'user', content: `Fix these problems and output the full corrected JSON: ${last}.` }];
    onProgress({ message: `Script check failed (${last.slice(0, 120)}); asking the model to fix it` });
  }
  if (best) { onProgress({ message: `Keeping the best valid attempt; ${best.value.meta.claimReview.summary.needsReview} claim(s) need your review` }); return polishScript(config, best.value, { topicFacts, facts, signal, onProgress }); }
  // diagnostics (raw responses + finish reasons) are kept for debugging; nothing partial is ever saved as a script
  try { const dir = path.join(PATHS.logs, 'scriptgen'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `failed-${Date.now()}.json`), JSON.stringify({ topic: config.topic, language: config.language.id, last, diagnostics }, null, 1)); } catch {}
  throw new Error(`the local model could not produce a valid ${config.language.name} script: ${last}`);
}


// ── claims to verify ─────────────────────────────────────────────────────────────────────────────────────────
// The local model can state wrong facts (seen: wrong year, wrong count, an invented event). It cannot reliably check
// itself, so every script carries the list of checkable claims (years, numbers, quantities, named people/places) that
// the reviewer must confirm before approving. Deterministic: nothing here depends on the model.
const NUM_WORDS = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|hundreds|thousand|thousands|million|millions|billion|crore|lakh|first|second|third)\b|(एक|दो|तीन|चार|पांच|पाँच|छह|सात|आठ|नौ|दस|बीस|सौ|हज़ार|हजार|लाख|करोड़|मिलियन|बिलियन|पहली|पहला|दूसरा)/gi;
export function extractClaims(script) {
  const out = [];
  script.lines.forEach((l, i) => {
    const t = String(l.text || ''), kinds = [];
    const years = t.match(/\b(1[0-9]{3}|20[0-9]{2})\b/g) || [];
    kinds.push(...years.map((y) => 'year ' + y));
    const nums = (t.match(/[₹$]?\d[\d,.]*\s?(%|crore|lakh|million|billion|km|kg)?/gi) || []).map((x) => x.trim().replace(/[.,]$/, '')).filter((x) => !years.includes(x));
    kinds.push(...nums.map((x) => 'number ' + x));
    const words = t.match(NUM_WORDS) || [];
    kinds.push(...[...new Set(words.map((w) => w.toLowerCase()))].map((w) => 'quantity "' + w + '"'));
    const names = t.replace(/^\S+\s*/, ' ').match(/\b[A-Z][a-z]{2,}(?:\s[A-Z][a-z]{2,})*/g) || [];
    kinds.push(...names.map((n) => 'name ' + n));
    if (kinds.length) out.push({ line: i + 1, text: t, check: [...new Set(kinds)] });
  });
  return out;
}

// ── story quality (topic-independent, deterministic) ────────────────────────────────────────────────────────
// Stock openings and endings the 4B model falls back to in every topic (seen across ISRO, temple bells, Roopkund).
const GENERIC_END = (/(^|\s)(देखें|देखिए|जानिए|सोचिए)\s*[!।]?\s*$|,\s*(देखें|देखो)\s*[!।]?\s*$/), GENERIC_END2 = /(शानदार उपलब्धि|कमाल की बात|गर्व की बात|कमाल है|अद्भुत है[!।]?\s*$|सच में कमाल|अद्भुत रहस्य[!।]?\s*$|आकर्षक प्रक्रिया|fascinating process|a fascinating (story|journey)[.!]?\s*$|amazing achievement|truly amazing|(cool|clever|neat|smart|amazing|incredible|fascinating) (design|trick|fact|thing)( indeed)?[.!]?s*$|nature is (amazing|incredible|fascinating)|isn'?t (nature|science) (amazing|incredible)|isn'?t (it|that) amazing|what an achievement|proud moment|like and subscribe|subscribe|share this video|kamaal hai|garv ki baat)/i;
const STOP = new Set('का की के को में से पर है हैं था थी थे और भी यह ये वह वो एक ने तो कि जो इस उस हो गया गई गए लिए साथ बहुत the a an of to in on at is are was were and or but so that this it its for with as by from be been has have had into than then they their there which who what when why how about very just also not no'.split(' '));
const words = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => [...w].length > 2 && !STOP.has(w));

/** Returns story problems as messages the model can act on (also used by the reviewer and the Script Studio card). */
export function storyProblems(script) {
  const lines = script.lines.map((l) => String(l.say || l.text || '')), out = [];
  if (lines.length && emptyHook(lines[0])) out.push('line 1 is a generic opening that names nothing specific (like "सुनो", "एक मिनट", a bare "क्या आप जानते हैं?"): open with a curiosity question or surprising detail that names the specific idea of THIS topic');
  if (lines.length > 1 && (GENERIC_END.test(lines.at(-1)) || GENERIC_END2.test(lines.at(-1)))) out.push(`line ${lines.length} is a generic ending ("amazing / गर्व की बात"): end with a concrete takeaway, a final surprising detail or a question that follows from this story`);
  // the same number stated again in a later line (repetition), unless the later line is a comparison of two values
  const seen = new Map();
  lines.forEach((t, i) => { for (const d of new Set(digitsOf(t))) { if (seen.has(d) && !/\bvs\b|बनाम|compared|तुलना|जबकि|while|whereas|than|से (कम|ज़्यादा|ज्यादा|अधिक)/i.test(t)) out.push(`line ${i + 1} repeats the number ${d} already given in line ${seen.get(d) + 1}: give new information instead`); else if (!seen.has(d)) seen.set(d, i); } });
  // near-duplicate lines (same content words)
  const W = lines.map((t) => new Set(words(t)));
  for (let i = 0; i < W.length; i++) for (let j = i + 1; j < W.length; j++) {
    const inter = [...W[i]].filter((w) => W[j].has(w)).length, uni = new Set([...W[i], ...W[j]]).size;
    if (uni >= 4 && inter / uni >= 0.5) out.push(`lines ${i + 1} and ${j + 1} say nearly the same thing: replace line ${j + 1} with the next step of the story`);
  }
  // exclamation on every line reads as shouting (seen: 8 of 9 Hindi lines ended with "!"); a good script uses one or two
  const bangs = lines.filter((t) => /!\s*$/.test(t)).length;
  if (lines.length >= 4 && bangs > Math.max(3, Math.round(lines.length * 0.4))) out.push(`${bangs} of ${lines.length} lines end with "!": keep at most three exclamations and let the facts carry the excitement`);
  // filler reactions that add no information
  const filler = lines.map((t, i) => (/(जानकर आप हैरान|आप हैरान हो जाएंगे|ये बहुत अजीब है|यह बहुत अजीब है|बहुत दिलचस्प है|ये एक बड़ी खोज थी|सच में अद्भुत|you('| wi)ll be (amazed|shocked|surprised)|very interesting|really fast|isn'?t that (crazy|wild)|mind-?blowing)/i.test(t) ? i + 1 : 0)).filter(Boolean);
  if (filler.length) out.push(`lines ${filler.join(', ')} contain a filler reaction ("you will be amazed", "बहुत दिलचस्प है"): replace it with a fact, a cause or a consequence`);
  // filler forms of address ("…थोड़ा अलग है, भाई।" twice in a 5-line script): at most one per script, never as a tail
  const voc = /(?:^|[\s,])(भाई|भाइयों|यार|दोस्तों|दोस्त|bhai|bhaee|yaar|dosto|doston)(?=[\s,।.!?]|$)/gi;
  const vocLines = lines.map((t, i) => ((String(t).match(voc) || []).length ? i + 1 : 0)).filter(Boolean);
  const vocTail = lines.map((t, i) => (/,\s*(भाई|यार|दोस्तों|bhai|bhaee|yaar|doston)\s*[।.!?]?\s*$/i.test(t) ? i + 1 : 0)).filter(Boolean);
  if (vocLines.length > 1 || vocTail.length) out.push(`lines ${[...new Set([...vocLines, ...vocTail])].join(', ')} use "भाई / यार / दोस्तों" as filler: address the viewer through the story itself (at most once per script, never tacked onto the end)`);
  // Hindi word order: a sentence that ends on an oblique-plural noun ("…बनी रही सालों।") has its verb in the middle
  const order = lines.map((t, i) => (/[ऀ-ॿ]ों\s*[।!]\s*$/.test(t) ? i + 1 : 0)).filter(Boolean);
  if (order.length) out.push(`lines ${order.join(', ')} end on a noun after the verb: in spoken Hindi the verb comes at the end ("सड़क सालों तक बनी रही")`);
  // the narration describing the picture instead of telling the story ("चाँद का गहरा चित्र, छाया के साथ स्क्रीन पर")
  const meta = lines.map((t, i) => (/स्क्रीन (पर|में)|(इस|यह|ये) (चित्र|तस्वीर)|चित्र में|on (the )?screen|in this (image|picture|shot)|the (image|picture) shows|we see here|chitra mein|screen par/i.test(t) ? i + 1 : 0)).filter(Boolean);
  if (meta.length) out.push(`lines ${meta.join(', ')} describe the picture or the screen instead of telling the story: say what happened or why`);
  // textbook Hindi where people speak English words (Hinglish and conversational Hindi)
  const shuddh = lines.map((t, i) => (/हृदय|रक्त|प्रणाली|छलावरण|मांसपेशि|संचालित|योजनाबद्ध|अत्यधिक|दुर्भाग्यवश|जलवायु परिवर्तन|आपूर्ति|समृद्धि|पलायन|संगठित|\b(hriday|rakt|pranali|chhalavran|mansapeshi\w*|sanchalit|yojnabaddh|atyadhik|durbhagyavash|jalvayu|aapurti|samriddhi|palayan|sangathit|pratiraksha|koshika\w*|vaijnanik\w*)\b/i.test(t) ? i + 1 : 0)).filter(Boolean);
  if (shuddh.length) out.push(`lines ${shuddh.join(', ')} use formal textbook Hindi (हृदय/रक्त/प्रणाली…): use the words people actually say (दिल/हार्ट, खून/ब्लड, सिस्टम)`);
  // telegraphic fragments: most lines far too short to be natural spoken sentences
  const short = lines.map((t, i) => (countWords(t) < 6 ? i + 1 : 0)).filter(Boolean);
  if (lines.length >= 4 && short.length > lines.length * 0.4) out.push(`lines ${short.join(', ')} are clipped fragments, not natural spoken sentences: write each as one complete sentence with a subject and a verb that explains something`);
  return [...new Set(out)];
}

// ── Stage A+B: understand the topic and plan the story (internal; never narrated) ───────────────────────────────
/**
 * One beat per line: the model chooses a single central story, keeps only the facts that serve it, orders them so
 * each beat follows from the previous one (cause → effect, problem → solution, then → next), and plans a concrete
 * hook and a payoff ending. Returns null when planning fails (generation then proceeds without a plan).
 */
export async function planStory(config, n, { facts = null, topicFacts = null, research = null, signal } = {}) {
  const pool = research?.evidence?.length ? research.evidence.map((e) => ({ kind: e.kind, text: e.text })) : [
    ...(topicFacts?.verified || []).map((x) => ({ kind: 'verified fact', text: typeof x === 'string' ? x : x.text })),
    ...(topicFacts?.theories || []).map((x) => ({ kind: 'theory (unproven)', text: typeof x === 'string' ? x : x.text })),
    ...(topicFacts?.legends || []).map((x) => ({ kind: 'legend/belief', text: typeof x === 'string' ? x : x.text })),
    ...String(facts || '').split(/\n+/).map((t) => t.trim()).filter(Boolean).map((t) => ({ kind: 'verified fact', text: t })),
  ];
  const sys = [
    'You are a story editor for 30–60 second educational YouTube Shorts. Plan the story before it is written. Output ONLY JSON matching the schema, in English.',
    'Choose ONE central story for the topic (a question the video answers, a problem and how it was solved, or a mystery and what was found). "centralStory" states the REAL answer concretely — the specific mechanism, cause, people or events (what exactly, how, why) — never a vague summary like "it helps them survive". Every beat must serve that story; leave out facts that do not, even if they are true.',
    'The beats must actually explain: name the specific parts, causes and consequences, so a viewer could repeat the explanation after watching.',
    `Plan exactly ${n} beats, one per narration line, in an order where each beat follows from the previous one (cause → effect, problem → solution, then → what happened next, claim → evidence). Each "point" is one short English sentence of what that line tells; "link" says how it connects to the previous beat (empty for beat 1).`,
    'Audience-first: the viewer may know nothing. Beat 1 is the hook — a curiosity question or surprising statement that names the specific idea of THIS topic (never an empty opener). Beat 2 is a short beginner bridge: what the subject is, in plain words. Then explain step by step, each unfamiliar term explained when first used, an analogy where it helps. The last beat is the conclusion — what it all means — optionally ending with a natural question to the viewer; never a generic "amazing achievement / proud moment" or "like and subscribe".',
    'A comparison (for example with a film budget) or a side fact (an address, a headquarters) belongs in the story only if it explains the central story; at most one comparison.',
    'No two beats may carry the same information. A number appears in only one beat unless a later beat compares it with another number.',
    pool.length ? 'Use ONLY the numbered facts below — add no other fact, name, place, number or detail ("facts" = the numbers of the facts a beat uses; every beat that states a fact must list it). A theory must stay a theory, a legend or belief must stay a belief, an estimate stays "about".' : 'No fact list is given: use only well-known, uncontroversial facts and no precise numbers you are unsure of.',
    ...(research?.essentials?.length ? [`ESSENTIAL (the story must include each of these): ${research.essentials.join('; ')}.`] : []),
  ].join('\n');
  const user = `Topic: ${config.topic}\nAudience: Indian viewers. Duration: ${config.durationSeconds} s.\n${pool.length ? 'Facts:\n' + pool.map((f, i) => `${i + 1}. [${f.kind}] ${f.text}`).join('\n') : ''}`;
  const schema = { type: 'object', properties: {
    centralStory: { type: 'string', maxLength: 200 },
    beats: { type: 'array', minItems: n, maxItems: n, items: { type: 'object', properties: { point: { type: 'string', maxLength: 180 }, link: { type: 'string', maxLength: 80 }, facts: { type: 'array', items: { type: 'integer' }, maxItems: 4 } }, required: ['point', 'link', 'facts'], additionalProperties: false } },
  }, required: ['centralStory', 'beats'], additionalProperties: false };
  try {
    const { text } = await chat({ messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], schema, temperature: 0.4, maxTokens: 300 + n * 90, signal });
    const p = JSON.parse(text);
    if (!Array.isArray(p.beats) || p.beats.length !== n) return null;
    p.beats.forEach((b) => { b.facts = (b.facts || []).filter((k) => k >= 1 && k <= pool.length); });
    p.usedFacts = [...new Set(p.beats.flatMap((b) => b.facts))].sort((a, b) => a - b).map((k) => pool[k - 1].text);
    p.beats.forEach((b) => { b.factTexts = b.facts.map((k) => pool[k - 1].text); b.factKinds = b.facts.map((k) => pool[k - 1].kind); });
    p.restricted = pool.length > 0;
    return p;
  } catch (e) { if (signal?.aborted) throw e; return null; }
}

/** The plan as writing instructions for the line writer. */
function planBlock(plan) {
  if (!plan) return '';
  return `STORY PLAN (in English for reference only — never copy its English wording into the narration; follow it, one line per beat, in this order; do not narrate the plan itself):\nCentral story: ${plan.centralStory}\n${plan.beats.map((b, i) => `Line ${i + 1}: ${b.point}${b.link ? ` (connects: ${b.link})` : ''}${b.factTexts?.length ? ` [facts: ${b.factTexts.join(' | ')}]` : ''}`).join('\n')}\n${plan.restricted ? 'FACTS: state only the facts listed in this plan — no other fact, name, place, number or detail, even if you believe it is true.\n' : ''}`;
}

// ── Stage A: research — coverage checklist and claim-to-source mapping ─────────────────────────────────────────
/**
 * The model's own memory is never treated as verified evidence. Facts from the topic fact file / user facts are
 * the evidence; when the model adds claims from its own knowledge, a separate strict pass judges each one
 * (true / false / unsure) and only "true" claims are kept — still marked source "model" (needs human research).
 * Essentials = people, events, places, dates or concepts the topic cannot be told without (seen missing: Sher Shah
 * Suri in a Grand Trunk Road script). Returns null if the model call fails.
 */
export async function researchTopic(config, { facts = null, topicFacts = null, signal } = {}) {
  const txt = (x) => (typeof x === 'string' ? x : x.text);
  const pool = [
    ...(topicFacts?.verified || []).map((x) => ({ kind: 'established', text: txt(x), source: `fact file: ${topicFacts.file || 'topic facts'}` })),
    ...(topicFacts?.theories || []).map((x) => ({ kind: 'speculation', text: txt(x), source: `fact file (theory): ${topicFacts.file || 'topic facts'}` })),
    ...(topicFacts?.legends || []).map((x) => ({ kind: 'legend', text: txt(x), source: `fact file (legend): ${topicFacts.file || 'topic facts'}` })),
    ...String(facts || '').split(/\n+/).map((t) => t.trim()).filter(Boolean).map((t) => ({ kind: 'established', text: t, source: 'facts given by the user' })),
  ];
  const schema = { type: 'object', properties: {
    essentials: { type: 'array', maxItems: 6, items: { type: 'object', properties: { name: { type: 'string', maxLength: 60 }, kind: { type: 'string', enum: ['person', 'place', 'event', 'concept'] } }, required: ['name', 'kind'], additionalProperties: false } },
    claims: { type: 'array', maxItems: 10, items: { type: 'object', properties: { text: { type: 'string', maxLength: 160 }, kind: { type: 'string', enum: ['established', 'estimate', 'reported', 'speculation'] } }, required: ['text', 'kind'], additionalProperties: false } },
  }, required: ['essentials', 'claims'], additionalProperties: false };
  const sys = [
    'You prepare research notes for a 30–60 second educational YouTube Short. Output ONLY JSON matching the schema, in English.',
    '"essentials": the people, events, places, dates or concepts WITHOUT WHICH this topic cannot be explained correctly (short names, at most 6). Only what is truly central — the key person behind it, the key event, the key mechanism. Give each a kind: person, place, event or concept (a mechanism, process or idea).',
    `"claims": ${pool.length ? 'up to 10 short factual statements NOT already in the fact list below that the story would still need' : 'up to 10 short factual statements needed to explain the topic correctly'}. kind = established (textbook fact), estimate (approximate number), reported (someone reported it), speculation (unproven theory).`,
    'Be conservative: only statements you are certain of. No precise numbers, distances, dates or locations unless certain. Prefer simple well-known explanations over impressive details. Never add a detail just to make the story more interesting.',
  ].join('\n');
  try {
    const { text } = await chat({ messages: [{ role: 'system', content: sys }, { role: 'user', content: `Topic: ${config.topic}\n${pool.length ? 'Fact list (already verified):\n' + pool.map((f, i) => `${i + 1}. ${f.text}`).join('\n') : ''}` }], schema, temperature: 0.2, maxTokens: 900, signal });
    const r = JSON.parse(text);
    const claims = (r.claims || []).map((c) => ({ text: String(c.text || '').trim(), kind: c.kind })).filter((c) => c.text);
    const ess = (r.essentials || []).map((e) => (typeof e === 'string' ? { name: e, kind: 'concept' } : e)).filter((e) => String(e.name || '').trim());
    const essentials = ess.map((e) => String(e.name).trim()), essentialKinds = Object.fromEntries(ess.map((e) => [String(e.name).trim(), e.kind]));
    // strict independent check of everything that came from the model's memory (claims + essentials)
    const stmts = [...claims.map((c) => c.text), ...essentials.map((e) => `"${e}" is a central part of the topic "${config.topic}".`)];
    let verdicts = [];
    if (stmts.length) {
      const vs = { type: 'object', properties: { verdicts: { type: 'array', minItems: stmts.length, maxItems: stmts.length, items: { type: 'object', properties: { verdict: { type: 'string', enum: ['true', 'false', 'unsure'] }, reason: { type: 'string', maxLength: 120 } }, required: ['verdict', 'reason'], additionalProperties: false } } }, required: ['verdicts'], additionalProperties: false };
      const vsys = 'You are a strict fact-checker. For each numbered statement answer "true" only if EVERY detail (who, what, where, when, which side, cause, number) is correct and well established; "false" if any detail is wrong or it is a common misconception; "unsure" if you are not certain. Give a short reason. Output ONLY JSON.';
      const { text: vt } = await chat({ messages: [{ role: 'system', content: vsys }, { role: 'user', content: stmts.map((s, i) => `${i + 1}. ${s}`).join('\n') }], schema: vs, temperature: 0, maxTokens: 120 + stmts.length * 60, signal });
      verdicts = JSON.parse(vt).verdicts || [];
    }
    const ok = (i) => verdicts[i]?.verdict === 'true';
    const kept = claims.filter((_, i) => ok(i)), rejected = claims.map((c, i) => ({ ...c, verdict: verdicts[i]?.verdict || 'unchecked', reason: verdicts[i]?.reason || '' })).filter((_, i) => !ok(i));
    return {
      essentials: essentials.filter((_, i) => ok(claims.length + i)), essentialKinds,
      evidence: [...pool, ...kept.map((c) => ({ ...c, source: 'model' }))],
      rejected,
      needsResearch: kept.length > 0 || !pool.length,
    };
  } catch (e) { if (signal?.aborted) throw e; return null; }
}

const GENERIC_TOKENS = new Set('road river city empire king queen mission planet moon earth water history science system people india indian the and of'.split(' '));
/** essentials not mentioned in the (Latin-script) text; [] when the text is not Latin (cannot be matched reliably) */
export function missingEssentials(research, text) {
  let t = String(text || '').toLowerCase();
  if (!research?.essentials?.length) return [];
  // Devanagari (native Hindi / Hinglish voice text): compare consonant skeletons of the romanised text, so
  // "शेर शाह सूरी" matches the essential "Sher Shah Suri"
  if (/[ऀ-ॿ]/.test(t)) {
    const romanSk = devanagariToHinglish(t).toLowerCase().split(/[^a-z]+/).filter(Boolean).map(skeleton);
    const has = (k) => { const ks = skeleton(k); return ks.length >= 2 && romanSk.some((w) => w === ks || (ks.length >= 3 && w.startsWith(ks))); };
    const named = research.essentials.filter((e) => !research.essentialKinds || research.essentialKinds[e] !== 'concept');
    return named.filter((e) => {
      const keys = ((String(e).match(/\b[A-Z][a-z'-]{2,}/g) || []).length ? String(e).match(/\b[A-Z][a-z'-]{2,}/g) : String(e).match(/[A-Za-z]{4,}/g) || []).map((w) => w.toLowerCase()).filter((w) => !GENERIC_TOKENS.has(w));
      return keys.length > 0 && !keys.some(has);
    });
  }
  if (!/[a-z]{3}/.test(t)) return [];
  return research.essentials.filter((e) => {
    const toks = (String(e).match(/[A-Za-z][A-Za-z'-]{3,}/g) || []).map((w) => w.toLowerCase()).filter((w) => !GENERIC_TOKENS.has(w));
    const caps = (String(e).match(/\b[A-Z][a-z'-]{2,}/g) || []).map((w) => w.toLowerCase()).filter((w) => !GENERIC_TOKENS.has(w));
    const keys = caps.length ? caps : toks;
    return keys.length > 0 && !keys.some((k) => t.includes(k.replace(/s$/, '')));
  });
}

// ── length fitting: bounded line-by-line shortening/expansion with fact guards ────────────────────────────────
/**
 * Up to 2 rounds; each line gets a word target scaled by (target time / estimated time). A rewritten line is kept
 * only if it keeps every number, stays a complete sentence in the right script, and the total moves closer to the
 * target. Never adds facts (no new digits) and never drops a number when shortening.
 */
export async function fitLength(config, value, { signal, onProgress = () => {}, chatFn = chat, stage = 'draft' } = {}) {
  // Root causes of "a 12 %-long script was not shortened" (fixed here):
  //  · a round was all-or-nothing — one line that grew discarded every line that shrank, and fitting stopped;
  //  · Hindi duration is measured in letters but targets were in words, so word cuts barely moved the estimate;
  //  · lines were silently rejected (e.g. a number written as a word, a stray Latin name) with no reason recorded;
  //  · fitting ran before the proof-read and hook/ending rewrite, which may lengthen lines afterwards
  //    (generateScript now fits again after the review).
  // Every line's decision is logged in meta.lengthFitLog; meta.lengthFit.improved is false when nothing improved.
  const deva = config.language.script === 'Deva', hing = config.language.id === 'hinglish', hi = config.language.code === 'hi';
  const form = (l) => (hing ? (l.say || l.text) : l.text);
  const size = (t) => (hi ? letters(t) : countWords(t) + numberExtraWords(t));
  let cur = value;
  const log = [...(value.meta.lengthFitLog || [])], start = estimateSeconds(value.script, config).seconds;
  for (let round = 1; round <= 3; round++) {
    const est = estimateSeconds(cur.script, config), off = est.speechSeconds / Math.max(1, est.targetSpeech);
    if (off >= 0.92 && off <= 1.08) { log.push({ stage, round, before: est.seconds, result: 'within ±8 % — no change needed' }); break; }
    onProgress({ indeterminate: true, message: `Fitting the length (${est.seconds} s for ${config.durationSeconds} s, round ${round})` });
    const src = cur.script.lines, n = src.length, shorten = off > 1;
    const pct = Math.round(Math.abs(1 - 1 / off) * 100);
    const sys = [
      `You edit narration lines for length. ${shorten ? `Make the WHOLE script about ${pct}% shorter` : `Make the WHOLE script about ${pct}% longer`}: each numbered line shows its own target in (brackets). Keep its meaning, every name and fact, in the same language and script (${deva || hing ? 'Devanagari' : 'English'}). Keep every number exactly as digits.`,
      `Each line stays one or two complete, natural spoken sentences ending with ${deva || hing ? '।, ? or !' : 'a full stop, ? or !'} and still follows from the line before it.`,
      shorten ? 'Shorten in this order: repeated information, filler and needless words, long phrasing → shorter phrasing. Never remove an essential fact, name, date, number or the cause-and-effect link between lines.' : 'Lengthen with a natural explaining phrase — never a new fact, name or number.',
      'Output ONLY JSON matching the schema.',
    ].join('\n');
    const schema = { type: 'object', properties: { lines: { type: 'array', minItems: n, maxItems: n, items: { type: 'string', maxLength: 400 } } }, required: ['lines'], additionalProperties: false };
    const entry = { stage, round, before: est.seconds, target: config.durationSeconds, direction: shorten ? 'shorten' : 'lengthen', lines: [] };
    let out;
    try {
      const { text, truncated } = await chatFn({ messages: [{ role: 'system', content: sys }, { role: 'user', content: src.map((l, i) => `${i + 1}. (${shorten ? `about ${pct}% shorter` : `about ${pct}% longer`}) ${form(l)}`).join('\n') }], schema, temperature: 0.2, maxTokens: Math.round(src.reduce((a, l) => a + form(l).length, 0) * (hing || deva ? 2.2 : 1.2)) + 300, signal });
      if (truncated) throw new Error('model output was cut off');
      out = parseJsonStrict(text)?.lines;
      if (!Array.isArray(out) || out.length !== n) throw new Error(`model returned ${Array.isArray(out) ? out.length : 0} lines for ${n}`);
    } catch (e) { if (signal?.aborted) throw e; entry.result = `rewrite failed: ${String(e.message).slice(0, 120)}`; log.push(entry); break; }
    // per-line decisions: a line is kept only if it is valid AND moves in the right direction
    const lines = src.map((l, i) => {
      const reject = (reason) => { entry.lines.push({ line: i + 1, result: 'rejected', reason }); return l; };
      let t = stripLeaks(westernPunct(String(out[i] || '').replace(/^\s*\d+[.)]\s+/, '').replace(/^\((?:about )?[^)]*\)\s*/i, '').trim()));
      if (!t) return reject('empty');
      if (deva || hing) t = cleanEnd(devaNames(asciiDigits(t)), true);
      const was = digitsOf(form(l)), now = digitsOf(t);
      if (now.some((d) => !was.includes(d))) return reject(`introduced a number (${now.filter((d) => !was.includes(d)).join(', ')})`);
      if (was.some((d) => !now.includes(d))) return reject(`dropped a number (${was.filter((d) => !now.includes(d)).join(', ')})`);
      if (danglingLine(t) || fillerTail(t)) return reject('incomplete sentence');
      if ((deva || hing) && !/[ऀ-ॿ]/.test(t)) return reject('not in Devanagari');
      if (hi && marathiWords(t)) return reject('Marathi words');
      const next = hing ? repairHinglish({ ...l, text: t, say: undefined }) : onScreenFor({ ...l, text: t });
      if (checkLanguage({ lines: [next] }, config).length) return reject(`language: ${checkLanguage({ lines: [next] }, config)[0].slice(0, 80)}`);
      const a = size(form(l)), b = size(form(next));
      if (shorten ? b >= a : b <= a) return reject(shorten ? 'not shorter' : 'not longer');
      if (shorten && b < a * 0.45) return reject('cut more than half the line (essential content at risk)');
      entry.lines.push({ line: i + 1, result: 'accepted', from: a, to: b });
      return next;
    });
    // apply accepted lines one by one (largest change first) and keep each only while it brings the script closer to
    // the target — an over-shortened rewrite (47 s → 30 s for 39 s) then keeps just the lines that are needed
    const offOf = (ls) => { const e = estimateSeconds({ ...cur.script, lines: ls }, config); return e.speechSeconds / Math.max(1, e.targetSpeech); };
    const order = lines.map((l, i) => i).filter((i) => lines[i] !== src[i]).sort((a, b) => Math.abs(size(form(lines[b])) - size(form(src[b]))) - Math.abs(size(form(lines[a])) - size(form(src[a]))));
    const pick = [...src];
    for (const i of order) {
      const trial = pick.map((l, k) => (k === i ? lines[i] : l));
      if (Math.abs(offOf(trial) - 1) < Math.abs(offOf(pick) - 1)) pick[i] = lines[i];
      else { const d = entry.lines.find((x) => x.line === i + 1); if (d) { d.result = 'not needed'; d.reason = 'the target was already reached without it'; } }
    }
    const script = { ...cur.script, lines: pick }, est2 = estimateSeconds(script, config), off2 = est2.speechSeconds / Math.max(1, est2.targetSpeech);
    entry.after = est2.seconds;
    if (Math.abs(off2 - 1) >= Math.abs(off - 1)) { entry.result = 'no improvement — kept the previous version'; log.push(entry); break; }
    entry.result = `improved ${est.seconds}s → ${est2.seconds}s`; log.push(entry);
    cur = { script, meta: { ...cur.meta, wordCount: est2.words, estimatedSeconds: est2.seconds } };
  }
  const end = estimateSeconds(cur.script, config).seconds;
  // changed lines → the fact review must describe the text that is actually saved
  if (cur !== value) cur = { ...cur, meta: { ...cur.meta, claimReview: reviewClaims(cur.script, { topic: config.topic, topicFacts: findTopicFacts(config.topic), userFacts: null }), claimsToVerify: extractClaims(cur.script) } };
  return { ...cur, meta: { ...cur.meta, lengthFitLog: log, lengthFit: { from: value.meta.lengthFit?.from ?? start, to: end, improved: end !== start && Math.abs(end - config.durationSeconds) < Math.abs(start - config.durationSeconds), stage } } };
}

// ── quality gates (separate; any failed gate keeps the script out of "Ready") ─────────────────────────────────
export function qualityGates(config, value, modelIssues = []) {
  const s = value.script, m = value.meta, research = m.research || null;
  const est = estimateSeconds(s, config), off = est.speechSeconds / Math.max(1, est.targetSpeech);
  const claims = m.claimReview?.claims || [];
  // the English draft's fact review counts for the translated script too (Hindi lines cannot match English theory keys)
  const draftBad = (m.draftFlags || []).filter((d) => !claims.some((c) => c.line === d.line && c.status === d.status));
  const bad = [...claims.filter((c) => c.status === 'contradicted' || c.status === 'needs-attribution'), ...draftBad];
  const sourced = !!(m.factFile || m.factsProvided);
  // with a source for the topic, every number/year the sources do not contain is named (seen: "1800 मील", "30%")
  const unsupportedNums = sourced ? claims.filter((c) => (c.kind === 'number' || c.kind === 'year') && c.status === 'unverified') : [];
  // re-checked on the FINAL lines (the proof-read may have edited them after generation)
  // names/numbers not in any source — recomputed on the FINAL lines (the stored list came from an earlier draft)
  const groundNow = m.groundText && (config.language.id === 'en' || config.language.id === 'hinglish')
    ? ungrounded(config.language.id === 'hinglish' ? s.lines.map((l) => `x ${(l.english || []).join(' ')} ${digitsOf(l.text).join(' ')}`) : s.lines.map((l) => l.text), m.groundText)
    : (m.ungrounded || []);
  const unframedNow = m.plan?.lineFacts ? unframedLines(config, s.lines, { beats: m.plan.lineFacts }) : (m.unframed || []);
  const lang = [...checkLanguage(s, config), ...(config.language.id === 'hinglish' ? hinglishProblems(s) : [])];
  const judged = m.editorialJudgment || null;
  const judgedIssues = judged ? [
    ...(judged.hook !== 'strong' ? [`hook is ${judged.hook}${judged.hookNote ? ` — ${judged.hookNote}` : ''}`] : []),
    ...(judged.ending !== 'payoff' ? [`ending is ${judged.ending}${judged.endingNote ? ` — ${judged.endingNote}` : ''}`] : []),
    ...(judged.flow !== 'connected' ? [`story reads as ${judged.flow}${judged.flowNote ? ` — ${judged.flowNote}` : ''}`] : []),
    ...((judged.repeats || []).filter((n) => n >= 2 && n <= s.lines.length).length ? [`lines ${(judged.repeats || []).filter((n) => n >= 2 && n <= s.lines.length).join(', ')} repeat information an earlier line already gave`] : []),
  ] : [];
  const used = new Set(m.plan?.usedFacts || []);
  const modelClaims = (research?.evidence || []).filter((e) => e.source === 'model' && (!m.plan?.usedFacts || used.has(e.text)));
  const needsResearch = !sourced || modelClaims.length > 0;
  const coverText = m.englishDraft?.lines?.join(' ') || s.lines.map((l) => l.text).join(' ');
  const missing = missingEssentials(research, coverText);
  const g = (ok, issues, extra = {}) => ({ ok, issues, ...extra });
  return {
    language: g(lang.length === 0, lang),
    facts: g(!bad.length && !needsResearch && !groundNow.length && !unframedNow.length && !unsupportedNums.length, [
      ...unsupportedNums.map((c) => `line ${c.line}: "${c.value}" is not in the verified facts — remove it or use the sourced value`),
      ...unframedNow.map((u) => `line ${u.line}: theory or legend stated as fact — the plan's source says: "${String(u.fact).slice(0, 100)}"`),
      ...groundNow.map((u) => `line ${u.line}: not in any source — ${u.terms.join(', ')}`),
      ...bad.map((c) => `line ${c.line}: ${c.status === 'contradicted' ? `known error — ${c.note || c.value || ''}` : `theory or belief stated as fact${c.value ? ` ("${String(c.value).slice(0, 80)}")` : ''}${c.fromDraft ? ' (in the English draft)' : ''}`}`),
      ...(needsResearch ? [`needs research: ${sourced ? `${modelClaims.length} claim(s) come from the model's own knowledge` : 'no verified source for this topic — every fact comes from the model\'s own knowledge'}; check them before approval`] : []),
    ], { needsResearch, unverifiedClaims: modelClaims.map((e) => e.text), rejectedByCheck: (research?.rejected || []).map((r) => `${r.text} (${r.verdict})`) }),
    coverage: g(!missing.length, missing.map((x) => `missing essential: ${x}`), { essentials: research?.essentials || [], checked: !!research && /[a-z]{3}/i.test(coverText) }),
    narrative: (() => {
      // audience check: the hook must be about THIS topic (English line, or the English plan point for Hindi/Hinglish)
      const hookText = config.language.id === 'en' ? s.lines[0]?.text : m.plan?.beats?.[0];
      const T = new Set(words(config.topic)), H = words(hookText || '');
      const offTopic = hookText && T.size && H.length && !H.some((w) => T.has(w) || [...T].some((x) => x.length > 4 && (w.startsWith(x.slice(0, 5)) || x.startsWith(w.slice(0, 5)))));
      const p = [...storyProblems(s), ...(offTopic ? ['line 1 does not mention the subject of the topic: a beginner cannot tell what the video is about'] : [])];
      return g(p.length === 0, p);
    })(),
    // Hindi/Hinglish lines are compared through their English plan beat (same line, same story point)
    terms: (() => { const beats = m.plan?.beats?.length === s.lines.length ? m.plan.beats : null; const tp = termProblems(config, s, { beats, englishLines: m.englishDraft?.lines || null, topicFacts: findTopicFacts(config.topic) }); return g(!tp.length, tp); })(),
    visuals: (() => { const beats = m.plan?.beats?.length === s.lines.length ? m.plan.beats : null; const tf = findTopicFacts(config.topic); const vp = visualProblems(s, { englishLines: m.englishDraft?.lines || null, beats, topic: config.topic, keyTerms: [...Object.keys(tf?.terms?.hi || {}), ...(research?.essentials || [])], shots: m.visuals?.shots?.length === s.lines.length ? m.visuals.shots : null }); return g(!vp.length, vp); })(),
    duration: g(off >= 0.9 && off <= 1.1, off >= 0.9 && off <= 1.1 ? [] : [`about ${est.seconds} s for a ${config.durationSeconds} s target`], { estimatedSeconds: est.seconds, target: config.durationSeconds }),
    // editorial = line-level proof-read + deterministic sentence checks + the whole-script judgment (hook, flow, ending);
    // the judgment can only hold a script back, never pass one the other checks failed
    // the whole-script model judgment is ADVISORY only: calibrated against the user's reference script it rated that script
    // exactly like a flat 4-line fact list (twice, Hindi and English), so it cannot decide READY; its notes are shown
    editorial: g(!modelIssues.length && !qualityProblems(s, config).length, [...modelIssues.map((x) => `line ${x.line}: ${x.problem}`), ...qualityProblems(s, config)], { judgment: judged, advisory: judgedIssues }),
  };
}

/** READY: every gate passes · FAILED: unusable (wrong language/script) · NEEDS_REVIEW: generated, correctable issues */
export function readiness(gates) {
  if (!gates) return 'NEEDS_REVIEW';
  if (!gates.language?.ok) return 'FAILED';
  return Object.values(gates).every((g) => g.ok) ? 'READY' : 'NEEDS_REVIEW';
}
/** the six gates grouped into the five reported results */
export function gateGroups(g) {
  const ok = (...k) => k.every((x) => !g[x] || g[x].ok);
  return { technical: ok('language', 'duration'), factual: ok('facts', 'coverage'), language: ok('language') && !(g.editorial?.issues || []).some((x) => /textbook|Devanagari|grammar|spelling|word order/i.test(x)), story: ok('narrative', 'visuals'), editorial: ok('editorial') };
}

/** last-resort spelling of a leftover Latin word (an unlisted name like "Tycho") in Devanagari, so one name cannot fail a script */
export function phoneticDeva(word) {
  const w = String(word).toLowerCase();
  const C = [['chh', 'छ'], ['ch', 'च'], ['sh', 'श'], ['th', 'थ'], ['kh', 'ख'], ['gh', 'घ'], ['ph', 'फ़'], ['bh', 'भ'], ['dh', 'ध'], ['jh', 'झ'], ['ck', 'क'], ['qu', 'क्व'], ['b', 'ब'], ['c', 'क'], ['d', 'ड'], ['f', 'फ़'], ['g', 'ग'], ['h', 'ह'], ['j', 'ज'], ['k', 'क'], ['l', 'ल'], ['m', 'म'], ['n', 'न'], ['p', 'प'], ['q', 'क'], ['r', 'र'], ['s', 'स'], ['t', 'ट'], ['v', 'व'], ['w', 'व'], ['x', 'क्स'], ['y', 'य'], ['z', 'ज़']];
  const V = [['aa', 'आ', 'ा'], ['ee', 'ई', 'ी'], ['oo', 'ऊ', 'ू'], ['ai', 'ऐ', 'ै'], ['au', 'औ', 'ौ'], ['ou', 'औ', 'ौ'], ['a', 'अ', ''], ['e', 'ए', 'े'], ['i', 'इ', 'ि'], ['o', 'ओ', 'ो'], ['u', 'उ', 'ु'], ['y', 'ई', 'ी']];
  let out = '', i = 0, prevCons = false;
  while (i < w.length) {
    const v = prevCons || i === 0 ? V.find(([k]) => w.startsWith(k, i)) : null;
    if (v && !(v[0] === 'y' && i === 0)) { out += prevCons ? v[2] : v[1]; i += v[0].length; prevCons = false; continue; }
    const c = C.find(([k]) => w.startsWith(k, i));
    if (!c) { i++; continue; }
    if (prevCons) out += '्';
    out += c[1]; i += c[0].length; prevCons = true;
  }
  return out;
}

// ── grounding: every name and number must come from the sources, the plan or the topic ─────────────────────────
// everyday English words Hinglish uses that are not names (capitalised in the check above, so they must be allowed)
const COMMON_EN = 'kilometer kilometers kilometre kilometres meter meters metre metres mile miles percent degree degrees hour hours minute minutes second seconds day days year years century centuries uniform access supply supplies few mission budget rocket science system phone mobile internet video money bank app online payment time speed heart blood oxygen water ice energy power heat weather city road trade data network story fact facts plan problem idea simple super fast slow scientist scientists team government school student students teacher class exam test result report news world country technology machine computer engine planet moon earth sun star space ocean sea forest river tree trees animal animals body brain cell cells virus germ vaccine doctor hospital record photo camera map line game match cricket film movie actor music hero';
const SENTENCE_WORDS = new Set('Did Do Does Have Has Had Is Are Was Were Can Could Would Should Will Ever Never Picture Think Look A An The This That These Those It Its They Their Then But And So Yet Today Now Later Once Long Every Each Some Many Most Why How What When Where Who Which Because After Before During While Over Under Without With Even Only Still Soon Imagine Here There Scientists Experts People Its No Yes One Two Three First Next Finally I We You He She Our Your His Her'.split(' '));
/** names (capitalised words) and numbers in English lines that appear nowhere in the allowed source text */
export function ungrounded(lines, allowedText) {
  const allow = String(allowedText || '').toLowerCase(), allowDigits = new Set(digitsOf(allowedText));
  const out = [];
  lines.forEach((t, i) => {
    // the first word of each sentence is capitalised anyway ("Reaching Mars…"): not a name
    const body = String(t).split(/(?<=[.!?;:])\s+/).map((x) => x.replace(/^\W*([A-Za-z]+)/, (m, w) => (/(ing|ed|ly|tion|sion|ness|ment|ful|ous|ive|able|ible|er|est|ic|ical|al|ary|ory|ity|ism|ist|ate|ize|ise|ent|ant|ence|ance|less|ward|wise)$/i.test(w) || SENTENCE_WORDS.has(w) ? '' : m))).join(' ');
    const names = (body.match(/\b[A-Z][a-zA-Z'’-]{2,}/g) || []).map((w) => w.replace(/['’]s$/, '')).filter((w) => !SENTENCE_WORDS.has(w) && !allow.includes(w.toLowerCase().replace(/s$/, '')));
    const nums = digitsOf(t).filter((d) => !allowDigits.has(d));
    const bad = [...new Set([...names, ...nums])];
    if (bad.length) out.push({ line: i + 1, terms: bad });
  });
  return out;
}

// ── visuals must show what their own line says ─────────────────────────────────────────────────────────────────
// seen: a smiling person on a Mumbai street over a Mars-mission line, a generic movie poster over a budget line
const GENERIC_VISUAL = /\b(smiling (man|woman|person|face|people)|happy (man|woman|person|people)|mumbai street|busy street|movie poster|film poster|stock (photo|image)|generic|abstract background|person thinking|presenter|host talking)\b/i;
const vwords = (s) => new Set(words(String(s || '').toLowerCase().replace(/(ies|es|s)\b/g, '')));
/** lines whose visual shares no subject with the line (English text or English draft) and the topic, or uses stock imagery */
// words that describe framing, not the subject ("Close-up shot of …", "showing", "illustration")
const FRAMING = new Set([
  ...'shot close wide medium aerial view angle low high slow motion time lapse timelapse scene image picture photo photograph illustration diagram animation animated render rendering rendered stylized detailed showing shows showcasing highlighting depicting depicted representing visible background foreground frame camera focus focusing subtle dramatic vibrant cinematic gentle gently slightly large small single several various'.split(' '),
  // abstract words a camera cannot show (a conclusion line "proof of their hard work" over the mission itself is fine)
  ...'thi story proof reaching reach journey lesson reason meaning mean matter important achievement legacy hard work skill courage just only also simply really truly whole thing way kind lot part fact idea question answer'.split(' '),
]);
const stem = (w) => w.slice(0, 5);
/**
 * Each visual is checked against the SPECIFIC subject of its own line — the line's planned story point (English) or
 * the English line — not against the whole topic: words shared with the topic ("octopus") do not count, framing
 * words do not count. A line about hemocyanin with a gill-only visual, or about the branchial hearts with an
 * unrelated heart, is a mismatch. When no English text exists to compare, the line is marked for human review
 * instead of passing silently.
 */
export function visualProblems(script, { englishLines = null, beats = null, topic = '', keyTerms = [], shots = null } = {}) {
  const out = [], T = vwords(topic), Tst = new Set([...T].map(stem));
  const KT = new Set(keyTerms.flatMap((k) => [...vwords(k)]).filter((w) => !FRAMING.has(w) && !Tst.has(stem(w))).map(stem));
  script.lines.forEach((l, i) => {
    const v = String(l.visual || ''), say = englishLines?.[i] || (/[a-z]{3}/i.test(l.text) ? l.text : ''), beat = beats?.[i] || '';
    const ref = [say, beat].filter(Boolean).join(' ');
    if (GENERIC_VISUAL.test(v) && !GENERIC_VISUAL.test(ref)) { out.push(`line ${i + 1}: stock/unrelated visual ("${v.slice(0, 60)}")`); return; }
    if (PEOPLE_VISUAL.test(v) && ref && !PEOPLE_WORDS.test(ref)) { out.push(`line ${i + 1}: shows people the line is not about ("${v.slice(0, 60)}")`); return; }
    if (!ref) { out.push(`line ${i + 1}: visual relevance could not be checked (no English text for this line) — review it`); return; }
    const V = new Set([...vwords(v)].filter((w) => !FRAMING.has(w)).map(stem));
    const specific = [...new Set([...vwords(ref)].filter((w) => !FRAMING.has(w) && !Tst.has(stem(w))))];
    if (!V.size) { out.push(`line ${i + 1}: the visual names no subject — review it`); return; }
    // the line's key term — a technical term of THIS topic (fact-file terms, research essentials), e.g. "hemocyanin",
    // "branchial" — must be shown when the line names one: a shared everyday word ("blood") does not make a gill-only
    // visual right for a hemocyanin line
    const key = specific.filter((w) => KT.has(stem(w)));
    // concept check: a key term that appears only among the background objects ("a gill … with a hemocyanin label")
    // is not the subject of the shot — the structured shot (subject + action) must carry it
    const shot = shots?.[i];
    if (key.length && shot && key.some((w) => V.has(stem(w)))) {
      const SA = new Set([...vwords(`${shot.subject || ''} ${shot.action || ''}`)].map(stem));
      if (!key.some((w) => SA.has(stem(w)))) { out.push(`line ${i + 1}: needs review — "${key[0]}" appears only in the background; the shot's subject is "${String(shot.subject || '').slice(0, 50)}"`); return; }
    }
    if (key.length && !key.some((w) => V.has(stem(w)))) out.push(`line ${i + 1}: needs review — the line is about ${key.slice(0, 3).join(', ')}, the visual shows "${v.slice(0, 60)}"`);
    else if (specific.length && !specific.some((w) => V.has(stem(w))) && ![...V].some((w) => Tst.has(w))) out.push(`line ${i + 1}: needs review — the line is about ${specific.slice(0, 4).join(', ')}, the visual shows "${v.slice(0, 60)}"`);
    else if (!specific.length && ![...V].some((w) => Tst.has(w))) out.push(`line ${i + 1}: the visual does not show what the line says ("${v.slice(0, 60)}")`);
  });
  return out;
}

/**
 * Strict JSON parse with STRUCTURAL repair only (code fences, text around the object, trailing commas, raw newlines
 * inside strings). Never changes content; returns null when the object is incomplete or still invalid.
 */
export function parseJsonStrict(text) {
  const t = String(text || '').trim();
  try { return JSON.parse(t); } catch {}
  let s = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  s = s.slice(a, b + 1).replace(/,\s*([}\]])/g, '$1');
  // raw newlines/tabs inside string literals → escaped
  let out = '', inStr = false, esc = false;
  for (const ch of s) {
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; else if (ch === '\n') { out += '\\n'; continue; } else if (ch === '\t') { out += '\\t'; continue; } }
    else if (ch === '"') inStr = true;
    out += ch;
  }
  if (inStr) return null;   // unterminated string = truncated output
  try { return JSON.parse(out); } catch { return null; }
}

// ── attribution words (uncertainty must be preserved through translation and editing) ────────────────────────
const EN_HEDGE = /\b(scientists (think|believe|suspect)|researchers (think|believe)|experts (think|believe)|it is (believed|thought)|may have|might have|may|might|possibly|probably|perhaps|likely|one (possible )?explanation|theory|legend says|according to (legend|folklore))\b/i;
const HI_HEDGE = /(माना जाता|मानना है|मानते हैं|शायद|संभव|संभवतः|हो सकता|हो सकती|हो सकते|सकता है|सकती है|सकते हैं|अनुमान|कहा जाता|किंवदंती|मान्यता|लोककथा|सिद्धांत|लगता है|विचार है|ऐसा माना)/;
const HG_HEDGE = /\b(maana jaata|mana jata|maanna hai|manna hai|shayad|sambhav|ho sakta|ho sakti|ho sakte|anumaan|kaha jaata|theory|scientists (think|believe|maante))/i;
export { EN_HEDGE, HI_HEDGE, HG_HEDGE };

// ── Hinglish validator (its own language mode) ─────────────────────────────────────────────────────────────────
/**
 * Hinglish lines carry a Roman caption (text) and a Devanagari voice form (say). Problems:
 * - say missing or not Devanagari (the Hindi voice cannot read it);
 * - an English-only line (most words are English) passing as Hinglish;
 * - textbook Hindi in place of everyday English technical words (handled by storyProblems).
 */
export function hinglishProblems(script) {
  const out = [];
  const noSay = [], english = [];
  script.lines.forEach((l, i) => {
    if (!l.say || !/[ऀ-ॿ]/.test(l.say) || /[A-Za-z]{3,}/.test(l.say)) noSay.push(i + 1);
    const ws = String(l.text || '').toLowerCase().match(/[a-z']+/g) || [];
    const en = new Set((l.english || []).map((w) => String(w).toLowerCase()));
    const enCount = ws.filter((w) => en.has(w) || ENGLISH_ONLY.has(w)).length;
    if (ws.length >= 4 && enCount / ws.length >= 0.7) english.push(i + 1);
  });
  if (noSay.length) out.push(`lines ${noSay.join(', ')} have no clean Devanagari voice form: the Hindi voice cannot read them`);
  if (english.length) out.push(`lines ${english.join(', ')} are English sentences, not Hinglish: say them the way people speak Hindi, keeping only common English terms`);
  // the opposite failure: plain (often textbook) Hindi silently passed off as Hinglish — real Hinglish keeps the
  // everyday English words people say (system, oxygen, heart, phone, data …)
  const enTotal = script.lines.reduce((a, l) => a + (l.english || []).length, 0);
  if (script.lines.length >= 3 && enTotal < Math.max(2, Math.round(script.lines.length * 0.5))) out.push(`only ${enTotal} English word(s) in ${script.lines.length} lines: this reads as plain Hindi, not Hinglish — use the English words people actually say for the technical and everyday terms`);
  return out;
}
// function words that only occur in English sentences (an English line, not Hindi with English nouns)
const ENGLISH_ONLY = new Set('the a an is are was were of to in on at and but or with from by for this that these those it its they their has have had be been will would can could should which who what when where why how into than then also very just not'.split(' '));

// ── claim ledger: every factual claim with an ID, line, status, source and explanation ─────────────────────────
/**
 * Statuses: VERIFIED (matches a verified fact; source given) · CONTRADICTED (matches a known error) ·
 * UNSUPPORTED (a fact file exists for the topic but does not contain it, or a theory/legend is stated as fact) ·
 * NEEDS_RESEARCH (no source for this topic; only the model's memory) · UNCERTAIN (framed as a theory/belief and the
 * framing is kept). The local model's own judgment never makes a claim VERIFIED.
 */
export function claimLedger(value, topicFacts = null, userFacts = null) {
  const m = value.meta || {}, sourced = !!(m.factFile || m.factsProvided);
  const claims = m.claimReview?.claims || [];
  const facts = [...(topicFacts?.verified || []).map((x) => (typeof x === 'string' ? x : x.text)), ...String(userFacts || '').split(/\n+/).filter(Boolean)];
  const factFor = (v) => { const k = String(v || '').toLowerCase().replace(/,/g, ''); return k ? facts.find((f) => f.toLowerCase().replace(/,/g, '').includes(k.replace(/\s*(crore|lakh|million|billion)$/, ''))) : null; };
  return claims.map((c, k) => {
    const status = c.status === 'supported' ? 'VERIFIED' : c.status === 'contradicted' ? 'CONTRADICTED' : c.status === 'needs-attribution' ? 'UNSUPPORTED'
      : c.status === 'framed' || c.status === 'attributed' ? 'UNCERTAIN' : sourced ? 'UNSUPPORTED' : 'NEEDS_RESEARCH';
    const explanation = status === 'VERIFIED' ? '' : status === 'CONTRADICTED' ? (c.correction || c.note || 'matches a known error')
      : status === 'UNSUPPORTED' ? (c.status === 'needs-attribution' ? `${c.note || 'theory or belief'} stated as fact — keep "scientists think" / "माना जाता है"` : 'not in the verified facts for this topic')
      : status === 'NEEDS_RESEARCH' ? 'no verified source for this topic; check against a reliable source' : 'framed as uncertain';
    return { id: `C${k + 1}`, line: c.line, claim: c.value || '', kind: c.kind || null, lineText: c.text || '', status,
      source: status === 'VERIFIED' ? { file: m.factFile || (m.factsProvided ? 'facts given by the user' : null), fact: factFor(c.value) } : null, explanation };
  });
}

// ── whole-script editorial judgment (hook, flow, ending) ───────────────────────────────────────────────────────
/**
 * Line-level checks cannot see that a script has no ending, opens with a plain date, or is a list of facts.
 * One strict model pass judges the whole script. It can only hold a script back (any verdict other than
 * strong / connected / payoff blocks READY); if it cannot run, the script is not READY either.
 */
export async function judgeScript(config, value, { signal } = {}) {
  const lines = value.script.lines, en = value.meta.englishDraft?.lines?.length === lines.length ? value.meta.englishDraft.lines : null;
  const schema = { type: 'object', properties: {
    hook: { type: 'string', enum: ['strong', 'weak', 'generic'] }, hookNote: { type: 'string', maxLength: 140 },
    flow: { type: 'string', enum: ['connected', 'choppy', 'list of facts'] }, flowNote: { type: 'string', maxLength: 140 },
    ending: { type: 'string', enum: ['payoff', 'abrupt', 'generic', 'repeats the opening'] }, endingNote: { type: 'string', maxLength: 140 },
    repeats: { type: 'array', maxItems: 8, items: { type: 'integer' } },
  }, required: ['hook', 'hookNote', 'flow', 'flowNote', 'ending', 'endingNote', 'repeats'], additionalProperties: false };
  const sys = [
    'You are a demanding senior editor of short documentary narration. Judge the WHOLE script. Output ONLY JSON. Be strict: most first drafts are NOT strong.',
    'hook: "strong" only if line 1 makes the viewer curious with a surprising, specific detail, question or contradiction about THIS topic. A curiosity question that names the specific idea ("Have you ever wondered why octopuses have three hearts?", "क्या आप जानते हैं कि …?") counts as strong. A plain date or definition is "weak"; an empty opener that names nothing ("listen", "one minute", a bare "did you know?") is "generic".',
    'flow: "connected" only if every line follows from the one before (cause → effect, then → next, question → answer) so it reads as one story. Short separate statements are "choppy"; facts that could be shuffled in any order are "list of facts".',
    'ending: "payoff" only if the last line resolves the story or says why it matters, specific to this topic. A last line that is just one more fact is "abrupt"; "amazing achievement / proud moment / will always be remembered" is "generic".',
    'repeats: the numbers of lines that say again what an EARLIER line already said, even in different words (e.g. a line restating that two periods are equal after the previous line already said so). Empty when every line adds new information.',
    'Each note says in a few words what is wrong (empty when the verdict is the best one).',
  ].join('\n');
  try {
    const { text, truncated } = await chat({ messages: [{ role: 'system', content: sys }, { role: 'user', content: `Topic: ${config.topic}\n${lines.map((l, i) => `${i + 1}. ${l.text}${en ? `  [${en[i]}]` : ''}`).join('\n')}` }], schema, temperature: 0, maxTokens: 400, signal });
    if (truncated) return { hook: 'weak', flow: 'choppy', ending: 'abrupt', hookNote: 'editor judgment was cut off', flowNote: '', endingNote: '', failed: true };
    return parseJsonStrict(text) || { hook: 'weak', flow: 'choppy', ending: 'abrupt', hookNote: 'editor judgment could not be read', flowNote: '', endingNote: '', failed: true };
  } catch (e) { if (signal?.aborted) throw e; return { hook: 'weak', flow: 'choppy', ending: 'abrupt', hookNote: `editor judgment could not run: ${String(e.message).slice(0, 80)}`, flowNote: '', endingNote: '', failed: true }; }
}

/** lines whose planned facts are a theory/legend but whose text (in its own language) has no uncertainty wording */
export function unframedLines(config, lines, plan) {
  if (!plan?.beats) return [];
  const hedge = config.language.script === 'Deva' ? HI_HEDGE : config.language.id === 'hinglish' ? null : EN_HEDGE;
  const out = [];
  lines.forEach((l, i) => {
    const b = plan.beats[i]; if (!b?.factKinds) return;
    const k = b.factKinds.findIndex((x) => /speculation|theory|legend|belief/i.test(String(x)));
    if (k < 0) return;
    const t = String(l.text || ''), say = String(l.say || '');
    const ok = hedge ? hedge.test(t) : (HG_HEDGE.test(t) || HI_HEDGE.test(say));
    if (!ok) out.push({ line: i + 1, fact: b.factTexts?.[k] || '' });
  });
  return out;
}


/** every Latin-letter word left in a Devanagari line → Devanagari (known names first, else phonetic); glosses dropped */
export function devaNames(text) {
  return devanagarizeLatin(String(text || ''))
    .replace(/\s*[(\[][^)\]ऀ-ॿ]*[A-Za-z][^)\]ऀ-ॿ]*[)\]]/g, '')
    .replace(/[‘’'"“”]([A-Za-z][A-Za-z\s-]*)[‘’'"“”]/g, '$1')
    .replace(/[A-Za-z]{2,}(?:-[A-Za-z]+)*/g, (w) => w.split('-').map(phoneticDeva).join('-'));
}

/**
 * Proper Devanagari spellings for the names of THIS topic (from the facts / essentials), asked once before writing:
 * Gemma knows "Mughal → मुग़ल", "Uttarapath → उत्तरापथ" when asked directly, but copies Latin names into Hindi
 * narration. Returns the map (word → Devanagari) and installs it for devanagarizeLatin / repairMixedWords.
 */
export async function topicNameSpellings(research, topic, { signal } = {}) {
  for (const k of Object.keys(TOPIC_NAMES)) delete TOPIC_NAMES[k];
  const text = [topic, ...(research?.essentials || []), ...(research?.evidence || []).map((e) => e.text)].join(' ');
  const body = text.split(/(?<=[.!?;:])\s+/).map((x) => x.replace(/^\W*\S+/, '')).join(' ');
  const words = [...new Set((body.match(/\b[A-Z][a-zA-Z-]{2,}/g) || []).flatMap((w) => w.split('-')).filter((w) => w.length >= 3 && !SENTENCE_WORDS.has(w)))].slice(0, 40);
  if (!words.length) return {};
  const schema = { type: 'object', properties: { names: { type: 'array', minItems: words.length, maxItems: words.length, items: { type: 'string', maxLength: 40 } } }, required: ['names'], additionalProperties: false };
  try {
    const { text: out } = await chat({ messages: [{ role: 'system', content: 'Write each numbered English name or word the way it is normally spelled in Hindi Devanagari (Mughal → मुग़ल, Uttarapath → उत्तरापथ, Kipling → किपलिंग, Jupiter → बृहस्पति). Devanagari only, one entry per line, same order. Output ONLY JSON.' }, { role: 'user', content: words.map((w, i) => (i + 1) + '. ' + w).join('\n') }], schema, temperature: 0, maxTokens: 60 + words.length * 20, signal });
    const arr = parseJsonStrict(out)?.names || [];
    words.forEach((w, i) => { const d = String(arr[i] || '').trim(); if (/^[ऀ-ॿ\s़-]+$/.test(d) && d.length <= 30) TOPIC_NAMES[w.toLowerCase()] = d; });
  } catch (e) { if (signal?.aborted) throw e; }
  return { ...TOPIC_NAMES };
}

// ── visual text normalisation (pure; regression-tested) ────────────────────────────────────────────────────────
// Seen: a regex written as /s+/g instead of /\s+/g replaced every letter "s" with a space ("Wide  hot",
// "Clo e-up", "A  tylized illu tration") in the generated data, before saving. Only whitespace is ever collapsed.
/** printable ASCII only, runs of whitespace → one space; letters are never removed */
export function visualText(s) { return String(s || '').replace(/\s+/g, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7E]/g, '').replace(/ {2,}/g, ' ').trim(); }
/** the model's one-sentence visual when usable (≥ 6 words, not a stitched "…, with …, with …" list), else the fallback */
export function chooseVisual(direct, fallback) {
  const d = visualText(direct);
  const usable = countWords(d) >= 6 && !/, *with .*, *with /i.test(d);
  const out = usable ? (/[.!]$/.test(d) ? d : d + '.') : String(fallback || '');
  return out.slice(0, 220);
}

// people shown where the line is not about people (seen: "a young boy on a hilltop" over a tidal-locking line)
export const PEOPLE_VISUAL = /\b(young (boy|girl|man|woman)|(a|an|the) (boy|girl|child|kid|man|woman|person|family|couple)|children|kids|crowd of people|group of (people|friends|students)|smiling|wide-eyed|in amazement)\b/i;
export const PEOPLE_WORDS = /\b(people|person|scientist|scientists|engineer|engineers|astronomer|astronomers|king|emperor|ruler|rulers|traveller|travellers|traveler|travelers|merchant|merchants|soldier|soldiers|workers|farmers|villagers|citizens|crowd|children|students|he|she|they|his|her|their|men|women|doctor|doctors|patient|patients|team|ruled|built|founded|discovered|invented)\b/i;


/** remove planning notes the model copied into a narration line, and orphan brackets / doubled sentence marks */
export function stripLeaks(t) {
  return String(t || '')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    // JSON-ish junk after the sentence: closing quote, comma, (emoji removed above), another quote … (seen on every line
    // of an Earth-rotation script). Only that signature is cut; normal quoted speech ("“hello”, and left") is kept.
    .replace(/\s*[”"]\s*,\s*[”"]?\s*,?\s*[“"”].*$/u, '')
    .replace(/\s*\[(?:facts?|connects?|visual|on ?screen|line \d+|source|beat)\s*:[^\]]*\]?/gi, '')
    .replace(/\s+(?:visual|on ?screen|facts?)\s*:\s.*$/i, '')
    .replace(/\s*\((?:connects?|facts?):[^)]*\)?/gi, '')
    .replace(/\s*\[\s*[।.!?]?\s*$/g, '')
    .replace(/([।.!?])\s*,\s*/g, '$1 ')
    .replace(/\s{2,}/g, ' ').trim();
}

// ── targeted hook / ending rewrite (bounded; only line 1 and the last line) ───────────────────────────────────
/**
 * The most common failure after planning: a flat first line (a date or definition) and a last line that stops on
 * one more fact. One rewrite of only those lines, driven by the editor's notes; a rewrite is kept only if it adds no
 * number the script does not already contain, stays in the right language/script, is not a stock opener/closer,
 * and the re-judgment is better. Never touches the middle of the story.
 */
export async function improveHookEnding(config, value, judged, { signal } = {}) {
  if (!judged || judged.failed) return { value, judged };
  const fixHook = judged.hook !== 'strong', fixEnd = judged.ending !== 'payoff';
  if (!fixHook && !fixEnd) return { value, judged };
  const lines = value.script.lines, n = lines.length, deva = config.language.script === 'Deva', hing = config.language.id === 'hinglish';
  const form = (l) => (hing ? (l.say || l.text) : l.text);
  const lang = deva || hing ? 'Hindi in Devanagari (common English words written in Devanagari)' : 'English';
  const sys = [
    `You are the editor of a short documentary narration in ${lang}. Rewrite ONLY the requested lines. Output ONLY JSON.`,
    'HOOK (line 1): a curiosity question or surprising statement that names the specific idea of THIS story (a "did you know …?" / "क्या आप जानते हैं कि …?" question is fine when it contains the specific idea) — never an empty opener like "listen", "सुनो", "एक मिनट", "today we will talk about".',
    'ENDING (last line): resolve the story or say why it matters, specific to this topic — never "amazing", "proud moment", "will always be remembered", "शानदार उपलब्धि", "गर्व की बात".',
    'Use only facts and numbers already in the script; add no new fact, name or number. Keep about the same length. One or two complete natural sentences.',
  ].join('\n');
  const schema = { type: 'object', properties: { hook: { type: 'string', maxLength: 260 }, ending: { type: 'string', maxLength: 260 } }, required: ['hook', 'ending'], additionalProperties: false };
  let out;
  try {
    const ask = `${fixHook ? `Rewrite line 1 (editor: ${judged.hookNote || judged.hook}).` : 'Keep line 1: return it unchanged.'} ${fixEnd ? `Rewrite the last line (editor: ${judged.endingNote || judged.ending}).` : 'Keep the last line: return it unchanged.'}`;
    const { text, truncated } = await chat({ messages: [{ role: 'system', content: sys }, { role: 'user', content: `Topic: ${config.topic}\n${lines.map((l, i) => `${i + 1}. ${form(l)}`).join('\n')}\n\n${ask}` }], schema, temperature: 0.4, maxTokens: 700, signal });
    if (truncated) return { value, judged };
    out = parseJsonStrict(text);
  } catch (e) { if (signal?.aborted) throw e; return { value, judged }; }
  if (!out) return { value, judged };
  const known = new Set(lines.flatMap((l) => digitsOf(form(l))));
  const accept = (t, old) => {
    let x = westernPunct(String(t || '').replace(/^\s*\d+[.)]\s+/, '').trim());
    if (!x || x === old) return null;
    if (deva || hing) x = cleanEnd(devaNames(asciiDigits(x)), true);
    if (digitsOf(x).some((d) => !known.has(d)) || danglingLine(x) || fillerTail(x)) return null;
    if (emptyHook(x) || GENERIC_END.test(x) || GENERIC_END2.test(x)) return null;
    if ((deva || hing) && (!/[ऀ-ॿ]/.test(x) || latinWords(x).length)) return null;
    if (!deva && !hing && /[ऀ-ॿ]/.test(x)) return null;
    return x;
  };
  const next = lines.map((l) => ({ ...l }));
  const put = (i, t) => { const x = accept(t, form(lines[i])); if (!x) return false; next[i] = hing ? repairHinglish({ ...lines[i], text: x, say: undefined }) : onScreenFor({ ...lines[i], text: x }); return checkLanguage({ lines: [next[i]] }, config).length === 0 || ((next[i] = lines[i]), false); };
  const changed = [fixHook && put(0, out.hook), fixEnd && n > 1 && put(n - 1, out.ending)].some(Boolean);
  if (!changed) return { value, judged };
  const cand = { ...value, script: { ...value.script, lines: next } };
  const est = estimateSeconds(cand.script, config), est0 = estimateSeconds(value.script, config);
  if (Math.abs(est.speechSeconds - est0.speechSeconds) > est0.speechSeconds * 0.12) return { value, judged };
  // accepted on the deterministic story checks (the model judgment cannot discriminate quality — see qualityGates)
  if (storyProblems(cand.script).length >= storyProblems(value.script).length || (fixHook && emptyHook(form(next[0])))) return { value, judged };
  const j2 = judged;   // the advisory model verdict is not consulted
  const topicFacts = findTopicFacts(config.topic);
  const review = reviewClaims(cand.script, { topic: config.topic, topicFacts, userFacts: null });
  return { value: { script: cand.script, meta: { ...value.meta, claimReview: review, claimsToVerify: extractClaims(cand.script), wordCount: est.words, estimatedSeconds: est.seconds, hookEndingRewrite: { hook: fixHook, ending: fixEnd, reason: [judged.hookNote, judged.endingNote].filter(Boolean), storyProblemsBefore: storyProblems(value.script).length, storyProblemsAfter: storyProblems(cand.script).length } } }, judged: j2 };
}

// ── hooks: curiosity questions are welcome when they carry the topic's specific idea ───────────────────────────
// Always empty: openers that say nothing about the topic. Curiosity openers ("did you know", "क्या आप जानते हैं कि")
// pass when at least 3 content words follow them (the specific idea), e.g. "क्या आप जानते हैं कि चाँद हमें हमेशा
// एक ही चेहरा क्यों दिखाता है?" — but a bare "क्या आप जानते हैं?" or "Did you know this?" is still empty.
const ALWAYS_EMPTY = /^\s*((तो\s*)?(सुनो|सूनो|एक मिनट|देखो|दोस्तों)[,!।\s]|आज हम (बात|जानेंगे)|ये कहानी बहुत कम|बहुत कम लोग जानते|today we('| a)re going to|today we will|let'?s talk about|in this video|hey guys|ek minute,? suno|aaj hum baat)/i;
const CURIOSITY = /(क्या आप(को)?\s+(जानते|पता)\s*(हैं|है)?\s*(कि)?|कभी आपने सोचा\s*(है)?\s*(कि)?|क्या आपने कभी (गौर|सोचा)\s*(किया)?\s*(है)?\s*(कि)?|did you know( that)?|have you ever (wondered|noticed|thought)( about)?( why| how| what)?|ever wondered( why| how)?|kya aap jaante (hain|ho)( ki)?)/i;
export function emptyHook(line) {
  const t = String(line || '');
  if (ALWAYS_EMPTY.test(t)) return true;
  const m = t.match(CURIOSITY);
  if (!m) return false;
  const rest = t.slice(m.index + m[0].length);
  return words(rest).length < 3;   // "why octopuses have three hearts" = 3 content words: specific enough
}

// ── technical terminology (Hindi / Hinglish voice text) ───────────────────────────────────────────────────────
// Seen: "इन्वटेरिया" for inertia. Similarity to the English word is NOT a reliable signal (the wrong spelling scored
// closer to "inertia" than the correct "इनर्शिया"), so terms are validated against TRUSTED spellings: the shared
// glossary + the topic fact file's terms. Nothing is replaced automatically — problems are reported for review.
function trustedTerms(topicFacts) {
  const out = Object.fromEntries(Object.entries(SCIENCE_TERMS).map(([k, v]) => [k, [...v]]));
  for (const [en, hi] of Object.entries(topicFacts?.terms?.hi || {})) {
    const forms = String(hi).split(/[()/,]/).map((x) => x.trim()).filter((x) => /[ऀ-ॿ]/.test(x));
    out[en.toLowerCase()] = [...new Set([...(out[en.toLowerCase()] || []), ...forms])];
  }
  return out;
}
const hasForm = (text, form) => { const f = form.length > 4 ? form.slice(0, form.length - 1) : form; return text.includes(f); };
/**
 * For each line: (1) every glossary/fact-file term named in the line's English plan point (or English line) must
 * appear in the Hindi voice text in one of its accepted forms — otherwise the term is likely misspelled or replaced;
 * (2) a Devanagari word whose consonant outline equals an accepted form but whose spelling differs is reported with
 * the standard spelling. Returns review messages.
 */
export function termProblems(config, script, { beats = null, englishLines = null, topicFacts = null } = {}) {
  if (config.language.code !== 'hi') return [];
  const T = trustedTerms(topicFacts), out = [];
  const vocab = [...new Set(Object.values(T).flat())];
  const sk = (d) => skeleton(devanagariToHinglish(d).toLowerCase());
  const vocabSk = vocab.filter((v) => !/\s/.test(v)).map((v) => ({ v, k: sk(v) })).filter((x) => x.k.length >= 3);
  script.lines.forEach((l, i) => {
    const voice = String(l.say || l.text || ''), ref = [englishLines?.[i], beats?.[i]].filter(Boolean).join(' ').toLowerCase();
    if (ref) for (const [en, forms] of Object.entries(T)) {
      if (!new RegExp(`\\b${en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(s|es)?\\b`).test(ref)) continue;
      if (!forms.some((f) => hasForm(voice, f))) out.push(`line ${i + 1}: the term "${en}" is not written in a standard form (${forms.slice(0, 3).join(' / ')}) — check the spelling`);
    }
    for (const w of new Set(voice.match(/[ऀ-ॣ]{4,}/g) || [])) {
      if (vocab.includes(w)) continue;
      const k = sk(w), hit = k.length >= 3 && vocabSk.find((x) => x.k === k && x.v !== w && !w.startsWith(x.v.slice(0, -1)));
      if (hit) out.push(`line ${i + 1}: "${w}" — the standard spelling is "${hit.v}"`);
    }
  });
  return [...new Set(out)];
}
