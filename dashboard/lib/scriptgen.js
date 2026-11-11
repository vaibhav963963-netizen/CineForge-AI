// Script generation with the local model. The validated config drives everything:
//   language  → writing rules (Devanagari / Roman Hinglish + Devanagari "say" / English) and the output check
//   personality → voice/tone instructions + delivery timing
//   duration  → a word budget from measured Kokoro speaking rates, and the number of lines (≈ one cut per line)
// Every line also carries an English "visual" description (what the viewer should see) and an optional on-screen
// text, which the storyboard planner turns into scenes.
import fs from 'node:fs';
import path from 'node:path';
import { chat, ensureServer, modelInfo } from './llm.js';
import { getCatalog } from './catalog.js';
import { devanagariToHinglish } from './translit.js';
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
export function estimateSeconds(script, config) {
  const d = config.narration.delivery, wps = wpsFor(config);
  const words = script.lines.reduce((a, l) => a + countWords(l.say || l.text), 0);
  return { words, seconds: +(words / (wps * config.narration.speed) + d.lead + d.outro + Math.max(0, script.lines.length - 1) * d.gap * 0.7).toFixed(1) };
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
  const line = { type: 'object', properties: { text: { type: 'string' },  visual: { type: 'string' }, onScreen: { type: 'string' } },
    required: ['text', 'visual'], additionalProperties: false };
  return { type: 'object', properties: { title: { type: 'string' }, lines: { type: 'array', items: line, minItems: Math.max(4, n - 3), maxItems: n + 3 } }, required: ['title', 'lines'], additionalProperties: false };
}

function prompt(config, n, budget) {
  const cat = getCatalog(), lang = cat.languages.find((l) => l.id === config.language.id), pers = cat.personalities.find((p) => p.id === config.narration.personality);
  const sys = [
    'You write narration scripts for vertical YouTube Shorts for an Indian audience. Output ONLY JSON matching the schema.',
    `LANGUAGE: ${lang.name}. ${lang.writing}`,
    `NARRATOR PERSONALITY: ${pers.name}. ${pers.voice}`,
    `LENGTH (strict): exactly ${n} lines of about ${Math.round(budget / n)} words each, about ${budget} spoken words in total and never more than ${Math.round(budget * 1.12)} (the narration must fit ${config.durationSeconds} seconds). Each line is one camera cut. End each sentence with proper punctuation${config.language.script === 'Deva' ? ' (। or ? or !)' : ''}.`,
    'STRUCTURE: line 1 is a hook that makes people stop scrolling; then build the story with concrete details; end with a satisfying payoff or twist.',
    'ACCURACY: only state facts you are confident are true. Prefer well-known facts. Do not invent quotes, statistics or sources. If unsure of an exact number, say it approximately.',
    'Write numbers the way they are spoken in the narration language. Never copy any number, name or example from these instructions into the script: every fact must come from the topic itself.',
    'For EVERY line add "visual": one short ENGLISH sentence describing what the viewer should SEE in that shot (name the concrete subject, what it is doing and the place). Never describe text or captions in "visual".',
    'Optionally add "onScreen": a very short on-screen text for that shot such as a number, year or comparison (a number with its unit, a year, or two labelled values joined by "vs"). Leave it out when nothing should appear. Use the same currency and units the narration uses (if the narration says ₹450 crore, show ₹450 crore, not dollars).',
    '"title": a short catchy title in the same language as the narration.',
  ].join('\n');
  const user = `Topic: ${config.topic}
Remember: exactly ${n} lines, each one short sentence of at most ${Math.round(budget / n) + 2} words, about ${budget} words in total.`;
  return [{ role: 'system', content: sys }, { role: 'user', content: user }];
}

// Hinglish: the model sometimes writes the caption line in Devanagari. Keep that as the spoken form and derive the
// Roman caption deterministically, instead of failing (the line is marked so the preview can show it).
const isDeva = (s) => ratio(String(s || '')).deva >= 0.85;
// Hindi (Devanagari) narration: Latin acronyms/names would be read with English phonemes by the Hindi voice, so they
// are written in Devanagari: known names from a small list, other ALL-CAPS acronyms letter by letter (PSLV → पी एस एल वी).
const DEVA_NAMES = { isro: 'इसरो', nasa: 'नासा', india: 'इंडिया', mars: 'मार्स', gravity: 'ग्रेविटी', hollywood: 'हॉलीवुड', bollywood: 'बॉलीवुड', mangalyaan: 'मंगलयान', chandrayaan: 'चंद्रयान', ipl: 'आईपीएल', bcci: 'बीसीसीआई', ai: 'एआई', dna: 'डीएनए', usa: 'अमेरिका', ok: 'ओके', tv: 'टीवी', fort: 'क़िला', boss: 'बॉस', youtube: 'यूट्यूब', google: 'गूगल', internet: 'इंटरनेट', mobile: 'मोबाइल', phone: 'फ़ोन', mission: 'मिशन', budget: 'बजट', rocket: 'रॉकेट', cricket: 'क्रिकेट', science: 'साइंस' };
const LETTER = { A: 'ए', B: 'बी', C: 'सी', D: 'डी', E: 'ई', F: 'एफ़', G: 'जी', H: 'एच', I: 'आई', J: 'जे', K: 'के', L: 'एल', M: 'एम', N: 'एन', O: 'ओ', P: 'पी', Q: 'क्यू', R: 'आर', S: 'एस', T: 'टी', U: 'यू', V: 'वी', W: 'डब्ल्यू', X: 'एक्स', Y: 'वाई', Z: 'ज़ेड' };
function devanagarizeLatin(text) {
  return String(text).replace(/[A-Za-z][A-Za-z.]*/g, (w) => {
    const bare = w.replace(/\./g, ''), k = bare.toLowerCase();
    if (DEVA_NAMES[k]) return DEVA_NAMES[k];
    if (/^[A-Z]{2,6}$/.test(bare)) return [...bare].map((c) => LETTER[c]).join(' ');
    return w;   // anything else stays and is reported back to the model by the language check
  });
}
export const latinWords = (text) => (String(text).match(/[A-Za-z]{2,}/g) || []);

function repairHinglish(l) {
  const hasDeva = (s) => /[ऀ-ॿ]/.test(String(s || ''));
  if (hasDeva(l.text) && (!l.say || !isDeva(l.say))) return { ...l, say: l.text, text: devanagariToHinglish(l.text), transliterated: true };
  if (hasDeva(l.text) && isDeva(l.say)) return { ...l, text: devanagariToHinglish(l.say), transliterated: true };
  return l;
}

/**
 * @param config  validated generation config
 * @param onProgress ({ current, total, message }) — tokens generated so far vs the expected token count
 */
export async function generateScript(config, { onProgress = () => {}, signal } = {}) {
  await ensureServer((m) => onProgress({ indeterminate: true, message: m }));
  const n = lineCount(config), budget = wordBudget(config, n);
  const tokensPerWord = config.language.code === 'hi' ? (config.language.id === 'hinglish' ? 6.5 : 4.5) : 2.6;
  const expected = Math.round(budget * tokensPerWord + n * 22 + 40);
  let messages = prompt(config, n, budget), last = null, attempts = 0;
  for (attempts = 1; attempts <= 4; attempts++) {
    const { text, tokens } = await chat({ messages, schema: schemaFor(config, n), temperature: attempts === 1 ? 0.75 : 0.45, maxTokens: Math.round(expected * 1.8) + 200, signal,
      onToken: (k) => { if (k % 8 === 0) onProgress({ current: Math.min(k, expected), total: expected, message: `Writing script (attempt ${attempts}): ${k} tokens` }); } });
    let script;
    try { script = JSON.parse(text); } catch { last = 'model output was not valid JSON'; messages = [...messages, { role: 'assistant', content: text.slice(0, 2000) }, { role: 'user', content: 'That was not valid JSON. Output only the JSON object.' }]; continue; }
    script.lines = (script.lines || []).map((l) => ({ text: String(l.text || '').trim(), ...(l.say ? { say: String(l.say).trim() } : {}), visual: String(l.visual || '').trim(), ...(l.onScreen && String(l.onScreen).trim() ? { onScreen: String(l.onScreen).trim() } : {}) })).filter((l) => l.text);
    if (config.language.id === 'hinglish') script.lines = script.lines.map((l) => repairHinglish({ ...l, text: devanagarizeLatin(l.text) }));
    if (config.language.script === 'Deva') script.lines = script.lines.map((l) => ({ ...l, text: devanagarizeLatin(l.text) }));
    const stray = config.language.script === 'Deva' ? [...new Set(script.lines.flatMap((l) => latinWords(l.text)))] : config.language.id === 'hinglish' ? [...new Set(script.lines.flatMap((l) => latinWords(l.say || '')))] : [];
    const problems = checkLanguage(script, config);
    if (stray.length) problems.push(`these English words must be written in Devanagari (or replaced by Hindi words): ${stray.slice(0, 12).join(', ')}`);
    const est = estimateSeconds(script, config);
    const off = est.words / budget;
    if (off < 0.75) problems.push(`the script is too short (${est.words} words; about ${budget} are needed for ${config.durationSeconds} s)`);
    if (off > 1.18) problems.push(`the script is too long (${est.words} words; it must be about ${budget}: exactly ${n} lines of about ${Math.round(budget / n)} words, so shorten every line)`);
    if (!problems.length) {
      return { script: { title: String(script.title || config.topic).trim(), lines: script.lines }, meta: { model: modelInfo(), attempts, tokens, transliteratedLines: script.lines.filter((l) => l.transliterated).length, wordBudget: budget, wordCount: est.words, estimatedSeconds: est.seconds, lineCount: script.lines.length } };
    }
    last = problems.join('; ');
    messages = [...messages, { role: 'assistant', content: text.slice(0, 4000) }, { role: 'user', content: `Fix these problems and output the full corrected JSON: ${last}.` }];
    onProgress({ message: `Script check failed (${last.slice(0, 120)}); asking the model to fix it` });
  }
  throw new Error(`the local model could not produce a valid ${config.language.name} script: ${last}`);
}
