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
import { PATHS } from './workspace.js';

// Words per second of speech at speed 1.0. Defaults measured from completed renders (Hindi hm_omega/hf_alpha ≈ 2.5,
// English am_michael ≈ 2.5, bm_george ≈ 2.2); refined per voice after every TTS stage (logs/calibration/voices.json).
export const WPS = { en: 2.35, hi: 2.5 };
const CAL_FILE = path.join(PATHS.logs, 'calibration', 'voices.json');
function readCal() { try { return JSON.parse(fs.readFileSync(CAL_FILE, 'utf8')); } catch { return {}; } }
export function wpsFor(config) {
  const c = readCal()[config.narration.voice];
  return c && c.samples >= 1 ? c.wps : (WPS[config.language.code] || 2.4);
}
/** after TTS: words actually spoken / speech seconds, normalised to speed 1.0 (rolling mean over the last 5 runs) */
export function recordVoiceRate(voice, words, speechSeconds, speed) {
  if (!(words > 10 && speechSeconds > 4)) return;
  const all = readCal(), v = all[voice] || { history: [] };
  v.history = [...(v.history || []), +(words / speechSeconds / speed).toFixed(3)].slice(-5);
  v.wps = +(v.history.reduce((a, b) => a + b, 0) / v.history.length).toFixed(3); v.samples = v.history.length; v.updatedAt = new Date().toISOString();
  all[voice] = v; fs.mkdirSync(path.dirname(CAL_FILE), { recursive: true }); fs.writeFileSync(CAL_FILE, JSON.stringify(all, null, 1));
}

export function wordBudget(config, nLines) {
  const d = config.narration.delivery, wps = wpsFor(config);
  const speech = config.durationSeconds - d.lead - d.outro - Math.max(0, nLines - 1) * d.gap * 0.7;
  return Math.max(20, Math.round(speech * wps * config.narration.speed));
}
// one line ≈ 4.2 s of narration: at 3.4 s Hindi lines were ~7 words and the model wrote clipped fragments that did not
// connect ("पांच नवंबर 2013 को, लॉन्च हुआ था।"); slightly longer lines leave room for complete, linked sentences
// (Hindi written directly only; English — including the English draft Hindi is translated from — keeps 3.4 s, which
// wrote complete sentences and hit the length, while 4.2 s made English lines overshoot)
export function lineCount(config) { return Math.max(6, Math.min(config.language.script === 'Deva' ? 16 : 18, Math.round(config.durationSeconds / (config.language.script === 'Deva' ? 4.2 : 3.4)))); }

export const countWords = (s) => String(s || '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
// Hindi: spoken length tracks letters far better than words (measured 8.96–9.79 letters/s across 4 narrations vs
// 2.10–2.76 words/s), so Devanagari narration is estimated by letters (incl. matras); English by words.
export const HINDI_CPS = 9.1;
const letters = (s) => String(s || '').replace(/[^\p{L}\p{M}\p{N}]/gu, '').length;
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
  const speech = config.language.code === 'hi' ? script.lines.reduce((a, l) => a + letters(l.say || l.text), 0) / (HINDI_CPS * config.narration.speed) : spokenWords / (wps * config.narration.speed);
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
  return problems;
}

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

function prompt(config, n, budget, facts, topicFacts = null) {
  const cat = getCatalog(), lang = cat.languages.find((l) => l.id === config.language.id), pers = cat.personalities.find((p) => p.id === config.narration.personality);
  const sys = [
    'You write narration scripts for vertical YouTube Shorts for an Indian audience. Output ONLY JSON matching the schema.',
    `LANGUAGE: ${lang.name}. ${lang.writing}`,
    `NARRATOR PERSONALITY: ${pers.name}. ${pers.voice}`,
    `LENGTH (strict): exactly ${n} lines of about ${Math.round(budget / n)} words each, about ${budget} spoken words in total and never more than ${Math.round(budget * 1.12)} (the narration must fit ${config.durationSeconds} seconds). Each line is one camera cut. End each sentence with proper punctuation${config.language.script === 'Deva' ? ' (। or ? or !)' : ''}.`,
    `STRUCTURE: line 1 is a hook that makes people stop scrolling; then build the story with concrete details${topicFacts || facts ? ' taken ONLY from the verified facts below' : ''}; end with a satisfying payoff or twist.`,
    'FLOW (very important): all lines together are ONE continuous story told by one narrator. Each line is exactly ONE complete, grammatical sentence (never split a sentence across two lines) that follows naturally from the line before it — when useful, START a sentence with a connecting word (then, but, so, that is why, and yet). Every line ends with a full stop (। in Hindi), ? or ! — never end a line with a connecting word like "and", "so", "then" (तो, फिर, और, इससे). Never write a list of separate facts, never start every line with a date, and never write half-sentences.',
    ...(config.language.script === 'Deva' ? ['HINDI QUALITY: use only real, common, correctly spelled Hindi words — never invent or misspell a word. Bronze is काँसा (never ताँका). Keep gender and number agreement correct (verb, adjective and postposition must agree with the noun). Prefer simple everyday sentences a native speaker would actually say; avoid literal translation from English. The hook must be an intriguing question or surprising statement about the topic itself.'] : []),
    'ACCURACY: only state facts you are confident are true. Prefer well-known facts. Do not invent quotes, statistics, sources, places, parks, people or organisations. If unsure of an exact number, say it approximately or leave it out.',
    'LEGENDS AND THEORIES: never tell a legend, myth or folklore as history: say "legend says" / "according to folklore". Present unproven explanations as theories: "scientists think", "may have". Keep the three apart: verified fact, theory, legend.',
    'Write numbers the way they are spoken in the narration language. Never copy any number, name or example from these instructions into the script: every fact must come from the topic itself.',
    `For EVERY line add "visual": one short sentence IN ENGLISH (Latin letters only, even when the narration is ${lang.name}) describing what the viewer should SEE in that shot (name the concrete subject, what it is doing and the place). Never describe text or captions in "visual".`,
    'Optionally add "onScreen": a very short on-screen text that repeats the key number, year or comparison spoken IN THAT SAME LINE (a number with its unit, a year, or two labelled values joined by "vs"). Never show something the line does not say. Leave it out when the line has no key number. Use the same currency and units the narration uses (if the narration says ₹450 crore, show ₹450 crore, not dollars).',
    '"title": a short catchy title in the same language as the narration.',
    ...(config.language.id === 'hinglish' ? ['For EVERY line add "english": the English words used in that line, in normal English spelling (e.g. for "भारत ने क्रिकेट मैच जीता" → ["cricket", "match"]); an empty list when the line has none. Do not list Hindi words.'] : []),
  ].join('\n');
  const user = `Topic: ${config.topic}
${(() => {
    const b = factsBlock(topicFacts, facts); if (!b) return '';
    // a fact file with no numbers: the model invented years and weights to sound concrete ("1947", "20 kg")
    const hasNums = /\d/.test(b.split('THEORIES')[0].split('BELIEFS')[0]);
    return `${b}\n\nNUMBERS: ${hasNums ? 'every year, date, number, weight and statistic in the narration AND the on-screen text must appear in the VERIFIED FACTS above; write no other number.' : 'the verified facts contain NO years, dates or statistics for this topic, so write NO years, dates, weights, percentages or statistics at all — explain with words, not numbers. Leave "onScreen" out or use a short word label.'}\n\n`;
  })()}Remember: exactly ${n} lines, each one complete sentence of about ${Math.round(budget / n)} words (at most ${Math.round(budget / n) + 3}) that connects to the previous line, about ${budget} words in total, telling one continuous story.`;
  return [{ role: 'system', content: sys }, { role: 'user', content: user }];
}

// Hinglish: the model sometimes writes the caption line in Devanagari. Keep that as the spoken form and derive the
// Roman caption deterministically, instead of failing (the line is marked so the preview can show it).
const isDeva = (s) => ratio(String(s || '')).deva >= 0.85;
// Hindi (Devanagari) narration: Latin acronyms/names would be read with English phonemes by the Hindi voice, so they
// are written in Devanagari: known names from a small list, other ALL-CAPS acronyms letter by letter (PSLV → पी एस एल वी).
const DEVA_NAMES = { isro: 'इसरो', nasa: 'नासा', india: 'इंडिया', mars: 'मार्स', gravity: 'ग्रेविटी', hollywood: 'हॉलीवुड', bollywood: 'बॉलीवुड', mangalyaan: 'मंगलयान', chandrayaan: 'चंद्रयान', ipl: 'आईपीएल', bcci: 'बीसीसीआई', ai: 'एआई', dna: 'डीएनए', usa: 'अमेरिका', ok: 'ओके', tv: 'टीवी', fort: 'क़िला', boss: 'बॉस', youtube: 'यूट्यूब', google: 'गूगल', internet: 'इंटरनेट', mobile: 'मोबाइल', phone: 'फ़ोन', mission: 'मिशन', budget: 'बजट', rocket: 'रॉकेट', cricket: 'क्रिकेट', science: 'साइंस', aarti: 'आरती', arti: 'आरती', aarati: 'आरती', puja: 'पूजा', pooja: 'पूजा', mandir: 'मंदिर', ghanta: 'घंटा', ghanti: 'घंटी', panchdhatu: 'पंचधातु', om: 'ॐ', mantra: 'मंत्र', shiva: 'शिव', ganesh: 'गणेश', bhagwan: 'भगवान', prasad: 'प्रसाद', diya: 'दीया', himalaya: 'हिमालय', himalayas: 'हिमालय', roopkund: 'रूपकुंड', mangal: 'मंगल', isro: 'इसरो', pslv: 'पीएसएलवी', bengaluru: 'बेंगलुरु', sriharikota: 'श्रीहरिकोटा' };
const LETTER = { A: 'ए', B: 'बी', C: 'सी', D: 'डी', E: 'ई', F: 'एफ़', G: 'जी', H: 'एच', I: 'आई', J: 'जे', K: 'के', L: 'एल', M: 'एम', N: 'एन', O: 'ओ', P: 'पी', Q: 'क्यू', R: 'आर', S: 'एस', T: 'टी', U: 'यू', V: 'वी', W: 'डब्ल्यू', X: 'एक्स', Y: 'वाई', Z: 'ज़ेड' };
// a word the model wrote half in Devanagari, half in Latin ("मंगalyaan", "पंचदhatu"): romanize the Devanagari part,
// join the Latin tail and match the known-word list by consonant skeleton → the proper Devanagari spelling
function repairMixedWords(text) {
  return String(text).replace(/[ऀ-ॿ]+[A-Za-z]+[ऀ-ॿA-Za-z]*|[A-Za-z]+[ऀ-ॿ]+[ऀ-ॿA-Za-z]*/g, (tok) => {
    const roman = tok.replace(/[ऀ-ॿ]+/g, (d) => devanagariToHinglish(d).toLowerCase()), key = skeleton(roman);
    const hit = Object.keys(DEVA_NAMES).find((k) => k.length >= 4 && skeleton(k) === key);
    return hit ? DEVA_NAMES[hit] : tok;
  });
}
export function devanagarizeLatin(text) {
  return repairMixedWords(text).replace(/[A-Za-z][A-Za-z.]*/g, (w) => {
    const bare = w.replace(/\./g, ''), k = bare.toLowerCase();
    if (DEVA_NAMES[k]) return DEVA_NAMES[k];
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
export const westernPunct = (s) => String(s || '').replace(/。/g, '.').replace(/！/g, '!').replace(/？/g, '?').replace(/，/g, ',').replace(/：/g, ':');

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
        // a real but wrong word ("चुनौतियाँ" = challenges where the story means घंटियाँ = bells) passes a grammar check;
        // with the English source each line must also MEAN what its source says
        ...(en ? ['Each line is a translation of the English source shown in [brackets]. Set ok=false if any word changes the meaning (a different object, person, place, number or claim than the source), and correct it to match the source.'] : []),
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
        const old = src[v.i].text, d = (s) => digitsOf(s).sort().join();
        if (fix === old || d(fix) !== d(old) || danglingLine(fix) || fillerTail(fix) || (deva && latinWords(fix).length)) continue;
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
  // the model's verdict never overrides the deterministic fact check
  for (const c of (cur.meta.claimReview?.claims || []).filter((x) => x.status === 'needs-attribution' || x.status === 'contradicted')) issues.push({ line: c.line, problem: c.status === 'contradicted' ? `known error: ${String(c.note || '').slice(0, 120)}` : 'belief or legend stated as fact — frame it ("माना जाता है" / "it is believed")' });
  const confirmed = issues.length === 0;
  onProgress({ message: confirmed ? `Local model confirmed the script (${rounds} round${rounds > 1 ? 's' : ''}, ${changed} line${changed === 1 ? '' : 's'} corrected)` : `Local model still flags ${issues.length} line(s): review them in Script Studio` });
  return { ...cur, meta: { ...cur.meta, llmReview: { confirmed, rounds: Math.min(rounds, 3), changedLines: changed, issues, reviewedAt: new Date().toISOString() } } };
}

export async function generateScript(config, opts = {}) {
  const r = await generateCore(config, opts);
  return reviewScript(config, r, opts);
}

async function generateCore(config, opts = {}) {
  // Hindi (Devanagari): Gemma 3 4B composes Hindi poorly (fragments, invented words, invented numbers) but writes good
  // English and translates reasonably. So the story is written and fact-checked in English first, then translated
  // line by line; every Hindi check (language, length, numbers, facts) runs again on the translation. If that path
  // fails, the direct Hindi path below is the fallback.
  if (config.language.script === 'Deva' && config.language.id !== 'hinglish') {
    try { return await viaEnglish(config, opts); }
    catch (e) { if (opts.signal?.aborted) throw e; (opts.onProgress || (() => {}))({ message: `English-first path failed (${String(e.message).slice(0, 120)}); writing directly in Hindi` }); }
  }
  return generateDirect(config, opts);
}

// Devanagari digits (२०१३) slip past every number check, which reads 0-9 ("८ साल" was not flagged); the voice reads both
const DEVA_DIGITS = '०१२३४५६७८९';
export const asciiDigits = (s) => String(s || '').replace(/[०-९]/g, (d) => String(DEVA_DIGITS.indexOf(d)));

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
    const lines = src.map((l, i) => onScreenFor({ text: cleanEnd(devanagarizeLatin(asciiDigits(westernPunct(out.lines?.[i] || '').replace(/^\s*\d+[.)]\s+/, '').trim())), true), visual: l.visual, ...(l.onScreen ? { onScreen: l.onScreen } : {}) }));
    const script = { title: asciiDigits(String(out.title || draft.script.title)).trim(), lines };
    const problems = [...checkLanguage(script, config), ...qualityProblems(script, config)];
    const stray = [...new Set(lines.flatMap((l) => latinWords(l.text)))];
    if (stray.length) problems.push(`write these words in Devanagari or use Hindi words: ${stray.slice(0, 10).join(', ')}`);
    // a number spelled out as a word ("7" → "सात") is fine; a digit that is new or changed would be an invented fact
    // million/billion ↔ crore/lakh conversions are equivalent ("$100 million" → "10 करोड़ डॉलर"): ×10, ×100 and inverses
    const same = (d, w) => [1, 10, 100, 0.1, 0.01].some((k) => Math.abs(+d - +w * k) < 1e-9);
    lines.forEach((l, i) => { const want = digitsOf(src[i].text), extra = digitsOf(l.text).filter((d) => !want.some((w) => same(d, w))); if (extra.length) problems.push(`line ${i + 1} has numbers that are not in the English line (${extra.join(', ')}); keep exactly ${want.join(', ') || 'no numbers'}`); });
    const est = estimateSeconds(script, config), off = est.speechSeconds / Math.max(1, est.targetSpeech);
    if (off < 0.9) problems.push(`the translation is too short (${est.seconds} s for ${config.durationSeconds} s): use fuller, natural sentences`);
    if (off > 1.1) problems.push(`the translation is too long (${est.seconds} s for ${config.durationSeconds} s): use shorter, simpler wording`);
    const review = reviewClaims(script, { topic: config.topic, topicFacts, userFacts: facts });
    const lengthOnly = problems.length && problems.every((p) => /too (short|long)/.test(p)) && off >= 0.8 && off <= 1.15;   // what TTS speed control can still absorb (1.25 failed at narration: 44.1 s for 40 s)
    const value = { script, meta: { ...draft.meta, viaEnglish: true, englishDraft: { title: draft.script.title, lines: src.map((l) => l.text) }, translationAttempts: attempt, claimReview: review, claimsToVerify: extractClaims(script), wordCount: est.words, estimatedSeconds: est.seconds, lineCount: n } };
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
  const tokensPerWord = config.language.code === 'hi' ? (config.language.id === 'hinglish' ? 6.5 : 4.5) : 2.6;
  const expected = Math.round(budget * tokensPerWord + n * 22 + 40);
  const topicFacts = findTopicFacts(config.topic);
  let messages = prompt(config, n, budget, facts, topicFacts), last = null, attempts = 0, review = null, best = null;
  for (attempts = 1; attempts <= 5; attempts++) {
    // Hindi at 0.75 produced invented words ("जहंके", "सूनो"); a cooler first attempt keeps the wording real
    const t1 = config.language.code === 'hi' ? 0.7 : 0.75;
    const { text, tokens } = await chat({ messages, schema: schemaFor(config, n, Math.round(budget / n) + 3), temperature: attempts === 1 ? t1 : 0.45, maxTokens: Math.round(expected * (attempts === 1 ? 1.8 : 2.6)) + 300,   // retries carry feedback; truncated JSON was seen on Hindi retries signal,
      onToken: (k) => { if (k % 8 === 0) onProgress({ current: Math.min(k, expected), total: expected, message: `Writing script (attempt ${attempts}): ${k} tokens` }); } });
    let script;
    try { script = JSON.parse(text); } catch { last = 'model output was not valid JSON'; messages = [...messages, { role: 'assistant', content: text.slice(0, 2000) }, { role: 'user', content: 'That was not valid JSON. Output only the JSON object.' }]; continue; }
    const raw = (script.lines || []).filter((l) => String(l.text || '').trim());
    script.lines = (script.lines || []).map((l) => ({ text: westernPunct(String(l.text || '').trim()), ...(l.say ? { say: westernPunct(String(l.say).trim()) } : {}), visual: String(l.visual || '').trim(), ...(l.onScreen && String(l.onScreen).trim() && !/^\s*(none|null|n\/?a|nil|nothing|-+|—|empty|no text|कुछ नहीं|कोई नहीं)?\s*$/i.test(String(l.onScreen)) ? { onScreen: String(l.onScreen).trim() } : {}) })).filter((l) => l.text);
    if (config.language.id === 'hinglish') script.lines = script.lines.map((l, i) => repairHinglish({ ...l, ...(Array.isArray(raw[i]?.english) ? { english: raw[i].english } : {}) }));
    // Hindi: the model sometimes appends a Roman transliteration — "घंटा लटका होता है। (Lagbhag har …)" — strip it
    // …and sometimes leaks other JSON fields into the line ("…हैरान! visual: Wide shot of …"): cut them off
    const stripRoman = (s) => String(s).replace(/\s*\b(?:visual|onScreen|on screen|say|english)\s*:.*$/i, '').replace(/\s*[(\[]\s*[A-Za-z][^)\]ऀ-ॿ]*[)\]]?\s*$/, '').trim();
    if (config.language.script === 'Deva') script.lines = script.lines.map((l) => ({ ...l, text: devanagarizeLatin(/[ऀ-ॿ]/.test(l.text) ? stripRoman(l.text) : l.text) }));
    const stray = config.language.script === 'Deva' ? [...new Set(script.lines.flatMap((l) => latinWords(l.text)))] : config.language.id === 'hinglish' ? [...new Set(script.lines.flatMap((l) => latinWords(l.say || '')))] : [];
    // every Devanagari line ends as a sentence (the voice pauses and captions break on it)
    if (config.language.script === 'Deva') script.lines = script.lines.map((l) => ({ ...l, text: cleanEnd(asciiDigits(l.text), true), ...(l.onScreen ? { onScreen: asciiDigits(l.onScreen) } : {}) }));
    // on-screen text must repeat something the same line says (seen: "बेंगलुरु" over a line about the payoff)
    script.lines = script.lines.map(onScreenFor);
    const problems = checkLanguage(script, config);
    if (stray.length) problems.push(`these English words must be written in Devanagari (or replaced by Hindi words): ${stray.slice(0, 12).join(', ')}`);
    const quality = qualityProblems(script, config);
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
    const bad = review.claims.filter((c) => c.status === 'contradicted' || c.status === 'needs-attribution');
    if (bad.length) soft.push(`fact problems: ${[...new Set(bad.map((c) => `line ${c.line}: ${c.status === 'contradicted' ? `wrong — ${c.note}` : `${c.kind} (${c.note})`}`))].join('; ')}`);
    if (topicFacts || facts) {   // every year and number must come from the verified facts (seen: "found them in 42" for 1942)
      const nums = review.claims.filter((c) => (c.kind === 'year' || c.kind === 'number') && c.status === 'unverified');
      // quote the verified fact that holds the same number, so the model gets the exact correction
      // (seen repeatedly: "Gravity ₹100 crore" while the fact says "about 100 million dollars")
      const factFor = (c) => { const d = (String(c.value).match(/\d[\d,]*/) || [''])[0].replace(/,/g, ''); return d && (topicFacts?.verified || []).map((x) => (typeof x === 'string' ? x : x.text)).find((tx) => tx.replace(/,/g, '').includes(d)); };
      if (nums.length) soft.push(`numbers not in the VERIFIED FACTS (narration or on-screen text): ${nums.map((c) => { const f = factFor(c); return `line ${c.line} "${c.value}"${f ? ` (the verified fact says: "${f}" — use exactly that, with its unit and currency)` : ''}`; }).join(', ')}. Use only numbers and years exactly as the verified facts give them (years in full, e.g. 1942), or leave the number out`);
    }
    const result = () => ({ script: { title: String(script.title || config.topic).trim(), lines: script.lines }, meta: { model: modelInfo(), attempts, tokens, factsProvided: !!facts, factFile: topicFacts?.file || null, claimReview: review, factRetryOpen: soft, claimsToVerify: extractClaims({ lines: script.lines }), transliteratedLines: script.lines.filter((l) => l.transliterated).length, wordBudget: budget, wordCount: est.words, estimatedSeconds: est.seconds, lineCount: script.lines.length } });
    // length is aimed at ±10 %; a script within ±20 % is still usable as a fallback because TTS duration control
    // re-times the narration within the personality's speed range (only the language checks are truly hard)
    const lengthOnly = problems.length > 0 && problems.every((p) => /^the script is too (short|long)/.test(p)) && off >= 0.8 && off <= 1.2;
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
