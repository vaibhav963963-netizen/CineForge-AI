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
import { getCatalog } from './catalog.js';
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
export function lineCount(config) { return Math.max(6, Math.min(18, Math.round(config.durationSeconds / 3.4))); }

export const countWords = (s) => String(s || '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
// Hindi: spoken length tracks letters far better than words (measured 8.96–9.79 letters/s across 4 narrations vs
// 2.10–2.76 words/s), so Devanagari narration is estimated by letters (incl. matras); English by words.
export const HINDI_CPS = 9.1;
const letters = (s) => String(s || '').replace(/[^\p{L}\p{M}\p{N}]/gu, '').length;
export function estimateSeconds(script, config) {
  const d = config.narration.delivery, wps = wpsFor(config);
  const words = script.lines.reduce((a, l) => a + countWords(l.say || l.text), 0);
  const speech = config.language.code === 'hi' ? script.lines.reduce((a, l) => a + letters(l.say || l.text), 0) / (HINDI_CPS * config.narration.speed) : words / (wps * config.narration.speed);
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

function schemaFor(config, n) {
  const hing = config.language.id === 'hinglish';
  // Hinglish: the model also lists the English words it used, so captions can keep their English spelling
  const line = { type: 'object', properties: { text: { type: 'string' }, visual: { type: 'string' }, onScreen: { type: 'string' }, ...(hing ? { english: { type: 'array', items: { type: 'string' }, maxItems: 10 } } : {}) },
    required: hing ? ['text', 'visual', 'english'] : ['text', 'visual'], additionalProperties: false };
  return { type: 'object', properties: { title: { type: 'string' }, lines: { type: 'array', items: line, minItems: Math.max(4, n - 3), maxItems: n + 3 } }, required: ['title', 'lines'], additionalProperties: false };
}

function prompt(config, n, budget, facts, topicFacts = null) {
  const cat = getCatalog(), lang = cat.languages.find((l) => l.id === config.language.id), pers = cat.personalities.find((p) => p.id === config.narration.personality);
  const sys = [
    'You write narration scripts for vertical YouTube Shorts for an Indian audience. Output ONLY JSON matching the schema.',
    `LANGUAGE: ${lang.name}. ${lang.writing}`,
    `NARRATOR PERSONALITY: ${pers.name}. ${pers.voice}`,
    `LENGTH (strict): exactly ${n} lines of about ${Math.round(budget / n)} words each, about ${budget} spoken words in total and never more than ${Math.round(budget * 1.12)} (the narration must fit ${config.durationSeconds} seconds). Each line is one camera cut. End each sentence with proper punctuation${config.language.script === 'Deva' ? ' (। or ? or !)' : ''}.`,
    `STRUCTURE: line 1 is a hook that makes people stop scrolling; then build the story with concrete details${topicFacts || facts ? ' taken ONLY from the verified facts below' : ''}; end with a satisfying payoff or twist.`,
    'ACCURACY: only state facts you are confident are true. Prefer well-known facts. Do not invent quotes, statistics, sources, places, parks, people or organisations. If unsure of an exact number, say it approximately or leave it out.',
    'LEGENDS AND THEORIES: never tell a legend, myth or folklore as history: say "legend says" / "according to folklore". Present unproven explanations as theories: "scientists think", "may have". Keep the three apart: verified fact, theory, legend.',
    'Write numbers the way they are spoken in the narration language. Never copy any number, name or example from these instructions into the script: every fact must come from the topic itself.',
    'For EVERY line add "visual": one short ENGLISH sentence describing what the viewer should SEE in that shot (name the concrete subject, what it is doing and the place). Never describe text or captions in "visual".',
    'Optionally add "onScreen": a very short on-screen text for that shot such as a number, year or comparison (a number with its unit, a year, or two labelled values joined by "vs"). Leave it out when nothing should appear. Use the same currency and units the narration uses (if the narration says ₹450 crore, show ₹450 crore, not dollars).',
    '"title": a short catchy title in the same language as the narration.',
    ...(config.language.id === 'hinglish' ? ['For EVERY line add "english": the English words used in that line, in normal English spelling (e.g. for "भारत ने क्रिकेट मैच जीता" → ["cricket", "match"]); an empty list when the line has none. Do not list Hindi words.'] : []),
  ].join('\n');
  const user = `Topic: ${config.topic}
${(() => {
    const b = factsBlock(topicFacts, facts); if (!b) return '';
    // a fact file with no numbers: the model invented years and weights to sound concrete ("1947", "20 kg")
    const hasNums = /\d/.test(b.split('THEORIES')[0].split('BELIEFS')[0]);
    return `${b}\n\nNUMBERS: ${hasNums ? 'every year, date, number, weight and statistic in the narration AND the on-screen text must appear in the VERIFIED FACTS above; write no other number.' : 'the verified facts contain NO years, dates or statistics for this topic, so write NO years, dates, weights, percentages or statistics at all — explain with words, not numbers. Leave "onScreen" out or use a short word label.'}\n\n`;
  })()}Remember: exactly ${n} lines, each one short sentence of at most ${Math.round(budget / n) + 2} words, about ${budget} words in total.`;
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

/**
 * @param config  validated generation config
 * @param onProgress ({ current, total, message }) — tokens generated so far vs the expected token count
 */
export async function generateScript(config, { onProgress = () => {}, signal, facts = null } = {}) {
  await ensureServer((m) => onProgress({ indeterminate: true, message: m }));
  const n = lineCount(config), budget = wordBudget(config, n);
  const tokensPerWord = config.language.code === 'hi' ? (config.language.id === 'hinglish' ? 6.5 : 4.5) : 2.6;
  const expected = Math.round(budget * tokensPerWord + n * 22 + 40);
  const topicFacts = findTopicFacts(config.topic);
  let messages = prompt(config, n, budget, facts, topicFacts), last = null, attempts = 0, review = null, best = null;
  for (attempts = 1; attempts <= 5; attempts++) {
    const { text, tokens } = await chat({ messages, schema: schemaFor(config, n), temperature: attempts === 1 ? 0.75 : 0.45, maxTokens: Math.round(expected * (attempts === 1 ? 1.8 : 2.6)) + 300,   // retries carry feedback; truncated JSON was seen on Hindi retries signal,
      onToken: (k) => { if (k % 8 === 0) onProgress({ current: Math.min(k, expected), total: expected, message: `Writing script (attempt ${attempts}): ${k} tokens` }); } });
    let script;
    try { script = JSON.parse(text); } catch { last = 'model output was not valid JSON'; messages = [...messages, { role: 'assistant', content: text.slice(0, 2000) }, { role: 'user', content: 'That was not valid JSON. Output only the JSON object.' }]; continue; }
    const raw = (script.lines || []).filter((l) => String(l.text || '').trim());
    script.lines = (script.lines || []).map((l) => ({ text: String(l.text || '').trim(), ...(l.say ? { say: String(l.say).trim() } : {}), visual: String(l.visual || '').trim(), ...(l.onScreen && String(l.onScreen).trim() && !/^\s*(none|null|n\/?a|nil|nothing|-+|—|empty|no text|कुछ नहीं|कोई नहीं)?\s*$/i.test(String(l.onScreen)) ? { onScreen: String(l.onScreen).trim() } : {}) })).filter((l) => l.text);
    if (config.language.id === 'hinglish') script.lines = script.lines.map((l, i) => repairHinglish({ ...l, ...(Array.isArray(raw[i]?.english) ? { english: raw[i].english } : {}) }));
    // Hindi: the model sometimes appends a Roman transliteration — "घंटा लटका होता है। (Lagbhag har …)" — strip it
    // …and sometimes leaks other JSON fields into the line ("…हैरान! visual: Wide shot of …"): cut them off
    const stripRoman = (s) => String(s).replace(/\s*\b(?:visual|onScreen|on screen|say|english)\s*:.*$/i, '').replace(/\s*[(\[]\s*[A-Za-z][^)\]ऀ-ॿ]*[)\]]?\s*$/, '').trim();
    if (config.language.script === 'Deva') script.lines = script.lines.map((l) => ({ ...l, text: devanagarizeLatin(/[ऀ-ॿ]/.test(l.text) ? stripRoman(l.text) : l.text) }));
    const stray = config.language.script === 'Deva' ? [...new Set(script.lines.flatMap((l) => latinWords(l.text)))] : config.language.id === 'hinglish' ? [...new Set(script.lines.flatMap((l) => latinWords(l.say || '')))] : [];
    const problems = checkLanguage(script, config);
    if (stray.length) problems.push(`these English words must be written in Devanagari (or replaced by Hindi words): ${stray.slice(0, 12).join(', ')}`);
    const est = estimateSeconds(script, config);
    const off = est.speechSeconds / Math.max(1, est.targetSpeech);   // estimated vs available speech time
    if (off < 0.9) problems.push(`the script is too short (it would last about ${est.seconds} s; ${config.durationSeconds} s are needed: add detail to each line)`);
    if (off > 1.1) problems.push(`the script is too long (it would last about ${est.seconds} s, the target is ${config.durationSeconds} s; about ${Math.round(est.words / off)} words: exactly ${n} lines of about ${Math.round(budget / n)} words, so shorten every line)`);
    // fact review (soft problems): a known error, a legend/theory told as fact, or — when verified facts exist — a
    // number or year they do not contain sends the script back with the correction. Soft problems never cost a valid
    // script: the best language- and length-valid attempt is kept, and if no attempt is fact-clean it is returned
    // with its flagged claims for the user to review (the render stays blocked until they do).
    review = reviewClaims({ title: script.title, lines: script.lines }, { topic: config.topic, topicFacts, userFacts: facts });
    const soft = [];
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
      const score = bad.length * 3 + review.summary.needsReview + (lengthOnly ? 2 : 0);
      if (!best || score < best.score) best = { score, value: result() };
      if (!problems.length && !soft.length) return best.value;
    }
    problems.push(...soft);
    last = problems.join('; ');
    messages = [...messages, { role: 'assistant', content: text.slice(0, 4000) }, { role: 'user', content: `Fix these problems and output the full corrected JSON: ${last}.` }];
    onProgress({ message: `Script check failed (${last.slice(0, 120)}); asking the model to fix it` });
  }
  if (best) { onProgress({ message: `Keeping the best valid attempt; ${best.value.meta.claimReview.summary.needsReview} claim(s) need your review` }); return best.value; }
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
