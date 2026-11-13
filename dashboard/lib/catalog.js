// Capability catalog: the single source of truth for which options exist and which ones the installed models can
// actually deliver. Everything here is detected from files on disk (no hardcoded "available" flags):
//   voices      ← the names stored inside models/kokoro/voices-v1.0.bin (a numpy .npz = zip archive)
//   whisper     ← models/whisper* (vocabulary size 51864 = English-only *.en model, 51865/51866 = multilingual)
//   llm         ← runtime/llama.cpp/llama-server + models/llm/*.gguf
//   comfyui     ← runtime/comfyui/main.py + its python + models/image-generation/checkpoints/*
//   fonts       ← assets/fonts (Devanagari caption font)
//   characters  ← config/characters.json ∩ the 3D archetypes actually implemented in character3d.js
//   styles      ← engine/styles/<id>/profile.json + example/ template
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, STUDIO_CONFIG, CHROME } from './workspace.js';
import { DESIGNS, LOOKS } from '../../engine/styles/tall-tale/example/src/core/characters/index.js';

// ── LANGUAGES ────────────────────────────────────────────────────────────────────────────────────────────────────
// ttsScript = the script the narration text must be in for Kokoro's phonemizer (espeak-ng 'hi' only reads Devanagari;
// Roman-script Hindi is phonemized as English). Hinglish therefore keeps Roman text for captions and carries a
// Devanagari "say" form per line for the voice.
export const LANGUAGES = [
  {
    id: 'hi-conversational', name: 'Hindi — Conversational (Devanagari)', code: 'hi', script: 'Deva', dialect: 'conversational', locale: 'hi-IN',
    ttsLang: 'hi', ttsScript: 'Deva', voiceLangs: ['hi'], whisperLanguage: 'hi', captionScript: 'Deva',
    writing: 'Write in natural, everyday spoken Hindi (Hindustani) in Devanagari script, the way people really talk. Common English words that Indians use in Hindi (mission, budget, phone, science) are fine, but write them in Devanagari (मिशन, बजट). Never write Roman/Latin letters. Never answer in English.',
  },
  {
    id: 'hi-formal', name: 'Hindi — Shuddh / Formal (Devanagari)', code: 'hi', script: 'Deva', dialect: 'formal', locale: 'hi-IN',
    ttsLang: 'hi', ttsScript: 'Deva', voiceLangs: ['hi'], whisperLanguage: 'hi', captionScript: 'Deva',
    writing: 'Write in clear, formal (shuddh) Hindi in Devanagari script, preferring Hindi/Sanskrit-origin vocabulary over English loanwords. Never write Roman/Latin letters. Never answer in English.',
  },
  {
    id: 'hinglish', name: 'Hinglish (Roman-script captions, Hindi voice)', code: 'hi', script: 'Latn', dialect: 'hinglish', locale: 'hi-IN',
    ttsLang: 'hi', ttsScript: 'Deva', voiceLangs: ['hi'], whisperLanguage: 'hi', captionScript: 'Latn',
    writing: 'Write Hinglish-style conversational Hindi: everyday spoken Hindi mixed with the common English words young Indians use, written ENTIRELY in Devanagari script (write English words phonetically in Devanagari too, e.g. मिशन, बजट, क्रिकेट). For science, tech and body words use the English word the way people actually speak (हार्ट, ब्लड, ऑक्सीजन, सिस्टम, कैमोफ्लाज), never formal textbook Hindi (हृदय, रक्त, प्रणाली, छलावरण, मांसपेशियाँ, संचालित, व्यवस्था). Never write Roman/Latin letters. The studio converts each line to Roman-script captions automatically and the Hindi voice reads the Devanagari.',
  },
  {
    id: 'en', name: 'English', code: 'en', script: 'Latn', dialect: 'standard', locale: 'en-IN',
    ttsLang: null /* from the voice: en-us or en-gb */, ttsScript: 'Latn', voiceLangs: ['en-us', 'en-gb'], whisperLanguage: 'en', captionScript: 'Latn',
    writing: 'Write in clear, natural spoken English for an Indian audience, ENTIRELY in English with Latin letters — never Hindi or Devanagari, even for Indian topics. Write numbers the way they are spoken.',
  },
];

// ── NARRATION PERSONALITIES ─────────────────────────────────────────────────────────────────────────────────────
// delivery = the audio settings Kokoro really supports: speaking speed, pause after each sentence, lead-in, outro.
// (Kokoro-82M has no pitch/emotion controls; personality is carried by the writing + these timing settings.)
export const PERSONALITIES = [
  {
    id: 'desi-storyteller', name: 'Desi Storyteller', blurb: 'Warm, engaging, culturally rooted storytelling.',
    languages: '*',
    voice: 'Warm and engaging, like a favourite elder cousin telling a story. Use relatable Indian everyday references and a gentle sense of wonder. Medium-length sentences; one vivid detail per sentence.',
    delivery: { speed: 1.0, gap: 0.28, lead: 0.3, outro: 1.0 },
  },
  {
    id: 'energetic-youtuber', name: 'Energetic Indian YouTuber', blurb: 'Fast, punchy hooks and rhetorical questions.',
    languages: '*',
    voice: 'High-energy Indian YouTuber. Open with the single most surprising concrete detail of THIS topic (a number, an outcome or a contradiction), not a generic question. Short punchy sentences, direct address to the viewer, fast rhythm, a twist at the end.',
    delivery: { speed: 1.1, gap: 0.16, lead: 0.2, outro: 0.8 },
  },
  {
    id: 'mumbai-conversational', name: 'Mumbai Conversational', blurb: 'Bambaiya street-smart Hindi ("Ek minute! Suno...").',
    languages: ['hi'],
    voice: 'Casual Mumbai-style conversational Hindi (Bambaiya flavour): friendly, street-smart, a little cheeky. Mumbai flavour comes from word choice and attitude ("बोले तो", "एकदम" once or twice where they fit naturally) — never as the opening words and never as filler; the story itself must carry the interest. Do not keep addressing the viewer as "भाई", "यार" or "दोस्तों" — at most once in a whole script, never tacked onto the end of a sentence. Keep it respectful, no slurs or vulgarity.',
    delivery: { speed: 1.06, gap: 0.2, lead: 0.25, outro: 0.9 },
  },
  {
    id: 'dramatic-mythology', name: 'Dramatic Mythology Narrator', blurb: 'Grand, reverent, slow, vivid imagery.',
    languages: '*',
    voice: 'Grand, reverent and cinematic, like an epic narrator. Vivid sensory imagery, measured pacing, a sense of awe. Respectful towards religious and historical figures. Do not present legend as proven science; say clearly when something is belief or tradition.',
    delivery: { speed: 0.94, gap: 0.4, lead: 0.4, outro: 1.3 },
  },
  {
    id: 'educational', name: 'Friendly Educational Explainer', blurb: 'Clear, structured, step by step.',
    languages: '*',
    voice: 'Friendly teacher. Explain step by step: question, how it works, the key fact, the takeaway. Define any technical term in simple words. Clear structure and simple sentences.',
    delivery: { speed: 1.0, gap: 0.3, lead: 0.3, outro: 1.0 },
  },
  {
    id: 'suspense', name: 'Suspenseful Mystery', blurb: 'Dramatic pacing, cliffhangers, slow reveals.',
    languages: '*',
    voice: 'Suspenseful true-mystery narrator. Short, tense sentences. Build up slowly, withhold the key fact, then reveal it. Calm, low and serious; never sensational or gory.',
    delivery: { speed: 0.95, gap: 0.42, lead: 0.4, outro: 1.3 },
  },
  {
    id: 'documentary', name: 'Documentary', blurb: 'Professional, informative, precise.',
    languages: '*',
    voice: 'Professional documentary narrator. Neutral, precise and informative. Concrete facts, dates and numbers; no slang; no exaggeration; calm authority.',
    delivery: { speed: 0.98, gap: 0.32, lead: 0.35, outro: 1.1 },
  },
];

// ── VOICES ───────────────────────────────────────────────────────────────────────────────────────────────────────
// Kokoro voice ids encode language + gender: a=American English, b=British English, h=Hindi; f=female, m=male.
const VOICE_LANG = { a: 'en-us', b: 'en-gb', h: 'hi' };
const VOICE_NOTES = {
  af_heart: 'warm, expressive (best English female)', af_bella: 'bright, youthful', af_nicole: 'soft, close', af_sarah: 'clear, neutral',
  af_sky: 'light, airy', af_nova: 'crisp', af_alloy: 'even', af_aoede: 'smooth', af_jessica: 'casual', af_kore: 'confident', af_river: 'calm',
  am_michael: 'steady explainer', am_puck: 'lively, playful', am_fenrir: 'deep, dramatic', am_onyx: 'low, calm', am_adam: 'plain',
  am_echo: 'mellow', am_eric: 'firm', am_liam: 'youthful', am_santa: 'jolly, deep',
  bf_emma: 'calm', bf_isabella: 'refined', bf_alice: 'clear', bf_lily: 'gentle',
  bm_george: 'documentary', bm_fable: 'storyteller', bm_daniel: 'measured', bm_lewis: 'deep',
  hf_alpha: 'Hindi female, clear', hf_beta: 'Hindi female, soft', hm_omega: 'Hindi male, warm', hm_psi: 'Hindi male, deep',
};
const RECOMMENDED = new Set(['af_heart', 'af_bella', 'am_michael', 'am_puck', 'am_fenrir', 'am_onyx', 'bm_george', 'bm_fable', 'bf_emma', 'hf_alpha', 'hf_beta', 'hm_omega', 'hm_psi']);

/** List the file names inside a .npz (zip) archive by reading its central directory. */
export function listNpzEntries(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size, tailLen = Math.min(size, 65557), tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('not a zip/npz archive');
    const count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOff = tail.readUInt32LE(eocd + 16);
    const cd = Buffer.alloc(cdSize); fs.readSync(fd, cd, 0, cdSize, cdOff);
    const names = [];
    for (let p = 0, n = 0; n < count && p < cdSize; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
      names.push(cd.toString('utf8', p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
    }
    return names;
  } finally { fs.closeSync(fd); }
}

function detectVoices() {
  const bin = path.join(PATHS.models.kokoro, 'voices-v1.0.bin'), onnx = path.join(PATHS.models.kokoro, 'kokoro-v1.0.onnx');
  if (!fs.existsSync(bin) || !fs.existsSync(onnx)) return { ready: false, reason: 'Kokoro model or voice pack missing in models/kokoro', voices: [] };
  let names = [];
  try { names = listNpzEntries(bin).map((n) => n.replace(/\.npy$/, '')); } catch (e) { return { ready: false, reason: `voice pack unreadable: ${e.message}`, voices: [] }; }
  const voices = names.filter((n) => VOICE_LANG[n[0]] && /^[a-z]{2}_/.test(n)).sort().map((id) => ({
    id, language: VOICE_LANG[id[0]], gender: id[1] === 'f' ? 'Female' : 'Male',
    accent: { a: 'American English', b: 'British English', h: 'Hindi' }[id[0]],
    name: `${id.split('_')[1][0].toUpperCase()}${id.split('_')[1].slice(1)}`,
    notes: VOICE_NOTES[id] || '', recommended: RECOMMENDED.has(id),
  }));
  return { ready: true, voices, model: 'Kokoro-82M v1.0 (ONNX)', totalInPack: names.length };
}

function whisperInfo(dir) {
  if (!fs.existsSync(path.join(dir, 'model.bin'))) return null;
  let vocab = 0;
  // count raw lines: one Whisper token is an empty string, so blank lines are real vocabulary entries
  try { const t = fs.readFileSync(path.join(dir, 'vocabulary.txt'), 'utf8').replace(/\r/g, ''); vocab = (t.endsWith('\n') ? t.slice(0, -1) : t).split('\n').length; } catch {}
  if (!vocab) try { const j = JSON.parse(fs.readFileSync(path.join(dir, 'vocabulary.json'), 'utf8')); vocab = j.length; } catch {}
  const multilingual = vocab >= 51865;
  let name = path.basename(dir);
  try { const meta = JSON.parse(fs.readFileSync(path.join(dir, 'studio-model.json'), 'utf8')); name = meta.name || name; } catch {}
  return { dir, vocab, multilingual, languages: multilingual ? '*' : ['en'], name: name === 'whisper' ? 'faster-whisper small.en' : name };
}
function detectWhisper() {
  const en = whisperInfo(PATHS.models.whisperEnglish), multi = whisperInfo(PATHS.models.whisperMultilingual);
  return { english: en, multilingual: multi && multi.multilingual ? multi : null };
}
/** the Whisper model that can align `lang` ('en' | 'hi'), or null */
export function whisperFor(lang, w = detectWhisper()) {
  if (lang === 'en') return w.english || w.multilingual;
  return w.multilingual;
}

function detectLLM() {
  const exe = ['llama-server.exe', 'llama-server'].map((f) => path.join(PATHS.llamaCpp, f)).find((f) => fs.existsSync(f));
  let models = [];
  try { models = fs.readdirSync(PATHS.models.llm).filter((f) => f.endsWith('.gguf')).map((f) => path.join(PATHS.models.llm, f)); } catch {}
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(PATHS.models.llm, 'studio-model.json'), 'utf8')); } catch {}
  const model = models.find((m) => path.basename(m) === meta.file) || models[0] || null;
  return {
    ready: !!(exe && model), exe: exe || null, model, name: meta.name || (model ? path.basename(model) : null), license: meta.license || null,
    reason: !exe ? 'llama.cpp server not installed (runtime/llama.cpp)' : !model ? 'no GGUF model in models/llm' : null,
  };
}

function detectComfy() {
  const main = path.join(PATHS.comfyui, 'main.py');
  const py = [path.join(PATHS.comfyui, 'venv', 'Scripts', 'python.exe'), path.join(PATHS.comfyui, 'venv', 'bin', 'python')].find((p) => fs.existsSync(p));
  const ckDir = path.join(PATHS.models.imageGeneration, 'checkpoints');
  let checkpoints = [];
  try { checkpoints = fs.readdirSync(ckDir).filter((f) => /\.(safetensors|ckpt|gguf)$/.test(f)); } catch {}
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(PATHS.models.imageGeneration, 'studio-model.json'), 'utf8')); } catch {}
  const ready = fs.existsSync(main) && !!py && checkpoints.length > 0;
  return {
    ready, python: py || null, checkpoints, checkpoint: meta.checkpoint && checkpoints.includes(meta.checkpoint) ? meta.checkpoint : checkpoints[0] || null,
    model: meta.name || checkpoints[0] || null, license: meta.license || null, settings: meta.settings || null,
    reason: !fs.existsSync(main) ? 'ComfyUI not installed (runtime/comfyui)' : !py ? 'ComfyUI python environment missing' : !checkpoints.length ? 'no image model in models/image-generation/checkpoints' : null,
  };
}

const DEVANAGARI_FONT_RE = /(devanagari|mukta|hind|tiro|kalam|poppins|baloo).*\.(ttf|otf|woff2?)$/i;
function detectFonts() {
  let files = [];
  try { files = fs.readdirSync(PATHS.fonts); } catch {}
  const deva = files.filter((f) => DEVANAGARI_FONT_RE.test(f));
  return { devanagari: deva.length ? { files: deva, family: 'StudioDeva' } : null, all: files };
}

function detectArchetypes() { return Object.keys(DESIGNS); }   // one folder per character in src/core/characters
function detectCharacters(archetypes) {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(PATHS.characters, 'utf8')); } catch {}
  const chars = list.map((c) => {
    const archetype = c.archetype || c.id, has3d = archetypes.includes(archetype);
    return {
      id: c.id, name: c.name, title: c.title, role: c.role, attire: c.attire, headwear: c.headwear, skin: c.skin, accentColor: c.accentColor,
      hairColor: c.hairColor, svgType: c.svgType, archetype, available: has3d, looks: (LOOKS[archetype] || []).map((l) => ({ id: l.id, name: l.name, overrides: l.overrides || null })),
      reason: has3d ? null : `no 3D design registered for "${archetype}" in character3d.js`,
    };
  });
  return [{ id: 'none', name: 'No Lead Character', title: 'Scenes without a recurring character', available: true, archetype: null }, ...chars];
}

function detectStyles() {
  let ids = [];
  try { ids = fs.readdirSync(PATHS.styles).filter((d) => fs.existsSync(path.join(PATHS.styles, d, 'profile.json'))); } catch {}
  return ids.map((id) => {
    const profile = JSON.parse(fs.readFileSync(path.join(PATHS.styles, id, 'profile.json'), 'utf8'));
    const template = path.join(PATHS.styles, id, 'example');
    const ok = fs.existsSync(path.join(template, 'index.html')) && (profile.renderer !== 'webgl' || fs.existsSync(path.join(template, 'vendor', 'three.module.js')));
    return { ...profile, available: ok, reason: ok ? null : 'style template incomplete' };
  });
}

let cache = null, cacheAt = 0;
/** Detect everything (cached for 5 s so a burst of requests doesn't rescan the disk). */
export function getCatalog(force = false) {
  if (!force && cache && Date.now() - cacheAt < 5000) return cache;
  const archetypes = detectArchetypes();
  const tts = detectVoices(), whisper = detectWhisper(), llm = detectLLM(), comfy = detectComfy(), fonts = detectFonts();
  const languages = LANGUAGES.map((l) => {
    const voices = tts.voices.filter((v) => l.voiceLangs.includes(v.language)).map((v) => v.id);
    const wm = whisperFor(l.code, whisper);
    const problems = [];
    if (!voices.length) problems.push('no installed Kokoro voice speaks this language');
    if (!wm) problems.push(`word alignment needs a ${l.code === 'en' ? '' : 'multilingual '}Whisper model (not installed)`);
    if (l.captionScript === 'Deva' && !fonts.devanagari) problems.push('no Devanagari caption font in assets/fonts');
    if (l.code === 'hi' && !fonts.devanagari && l.captionScript === 'Latn') { /* Roman captions: Inter is fine */ }
    return {
      ...l, voices, alignmentModel: wm ? wm.name : null, available: problems.length === 0, problems,
    };
  });
  cache = {
    generatedAt: new Date().toISOString(),
    languages,
    personalities: PERSONALITIES.map((p) => ({ ...p, languageCodes: p.languages === '*' ? ['en', 'hi'] : p.languages })),
    voices: tts.voices,
    styles: detectStyles(),
    characters: detectCharacters(archetypes),
    archetypes,
    duration: { min: STUDIO_CONFIG.generation.durationMin, max: STUDIO_CONFIG.generation.durationMax, tolerance: STUDIO_CONFIG.generation.durationTolerance },
    output: { resolution: STUDIO_CONFIG.generation.resolution, fps: STUDIO_CONFIG.generation.fps },
    visualModes: [
      { id: 'hybrid-local', name: 'Hybrid (local AI images + 3D/2D animation)', available: comfy.ready, reason: comfy.reason },
      { id: 'procedural', name: 'Procedural only (3D/2D animation, no AI images)', available: true, reason: null },
    ],
    engines: {
      tts: { ready: tts.ready, model: tts.model, reason: tts.reason || null, voicesInPack: tts.totalInPack || 0 },
      whisper: { english: whisper.english && { name: whisper.english.name, multilingual: whisper.english.multilingual }, multilingual: whisper.multilingual && { name: whisper.multilingual.name } },
      llm: { ready: llm.ready, name: llm.name, license: llm.license, reason: llm.reason },
      comfyui: { ready: comfy.ready, model: comfy.model, license: comfy.license, reason: comfy.reason },
      chrome: { ready: !!CHROME, path: CHROME },
      ffmpeg: { ready: fs.existsSync(PATHS.ffmpeg) && fs.existsSync(PATHS.ffprobe) },
      python: { ready: fs.existsSync(PATHS.python) },
      fonts: { devanagari: fonts.devanagari },
    },
    _internal: { whisper, llm, comfy, fonts },
  };
  cacheAt = Date.now();
  return cache;
}

/** Catalog without internal absolute paths, for the browser. */
export function publicCatalog() {
  const { _internal, ...pub } = getCatalog();
  return pub;
}
