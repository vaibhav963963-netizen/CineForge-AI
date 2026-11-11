// Generation-config validation. The dashboard sends option *ids*; this turns them into one validated, normalized
// generation configuration or a list of field errors. It never substitutes a default for something the user picked:
// a missing or unsupported value is an error that names the genuinely supported alternatives.
import crypto from 'node:crypto';
import { getCatalog } from './catalog.js';

const err = (field, message, alternatives) => ({ field, message, ...(alternatives ? { alternatives } : {}) });

/**
 * @param {object} input  { topic, language, personality, voice, style, character, durationSeconds, visualMode, speed? }
 * @param {object} opts   { purpose: 'script' | 'render', hasApprovedScript: boolean }
 * @returns {{ ok: boolean, errors: object[], warnings: string[], config?: object }}
 */
export function validateGenerationConfig(input = {}, { purpose = 'render', hasApprovedScript = false } = {}) {
  const cat = getCatalog();
  const errors = [], warnings = [];
  const req = (field) => { if (input[field] === undefined || input[field] === null || input[field] === '') { errors.push(err(field, `${field} is required`)); return false; } return true; };

  // topic
  const topic = typeof input.topic === 'string' ? input.topic.trim().replace(/\s+/g, ' ') : '';
  if (!topic) errors.push(err('topic', 'Enter a topic or question.'));
  else if (topic.length < 4) errors.push(err('topic', 'Topic is too short (min 4 characters).'));
  else if (topic.length > 220) errors.push(err('topic', 'Topic is too long (max 220 characters).'));

  // language
  let language = null;
  if (req('language')) {
    language = cat.languages.find((l) => l.id === input.language);
    if (!language) errors.push(err('language', `Unknown language "${input.language}".`, cat.languages.map((l) => l.id)));
    else if (!language.available) errors.push(err('language', `${language.name} is not available on this machine: ${language.problems.join('; ')}.`, cat.languages.filter((l) => l.available).map((l) => l.id)));
  }

  // personality (+ language compatibility)
  let personality = null;
  if (req('personality')) {
    personality = cat.personalities.find((p) => p.id === input.personality);
    if (!personality) errors.push(err('personality', `Unknown narration personality "${input.personality}".`, cat.personalities.map((p) => p.id)));
    else if (language && !personality.languageCodes.includes(language.code)) {
      errors.push(err('personality', `"${personality.name}" requires ${personality.languageCodes.map((c) => (c === 'hi' ? 'Hindi or Hinglish' : 'English')).join(' / ')}; it cannot be used with ${language.name}.`,
        cat.personalities.filter((p) => p.languageCodes.includes(language.code)).map((p) => p.id)));
    }
  }

  // voice (+ language compatibility)
  let voice = null;
  if (req('voice')) {
    voice = cat.voices.find((v) => v.id === input.voice);
    if (!voice) errors.push(err('voice', `Voice "${input.voice}" is not installed in models/kokoro/voices-v1.0.bin.`, language ? language.voices : cat.voices.map((v) => v.id)));
    else if (language && !language.voiceLangs.includes(voice.language)) {
      errors.push(err('voice', `Voice "${voice.id}" is a ${voice.accent} voice and cannot narrate ${language.name}. Compatible installed voices: ${language.voices.join(', ') || 'none'}.`, language.voices));
    }
  }

  // narration speed (optional explicit override, else the personality's delivery speed)
  let speed = personality ? personality.delivery.speed : null;
  if (input.speed !== undefined && input.speed !== null && input.speed !== '') {
    const s = Number(input.speed);
    if (!Number.isFinite(s) || s < 0.8 || s > 1.25) errors.push(err('speed', 'Narration speed must be between 0.80 and 1.25.'));
    else speed = Math.round(s * 100) / 100;
  }

  // style
  let style = null;
  if (req('style')) {
    style = cat.styles.find((s) => s.id === input.style);
    if (!style) errors.push(err('style', `Unknown visual style "${input.style}".`, cat.styles.map((s) => s.id)));
    else if (!style.available) errors.push(err('style', `Style "${style.name}" template is incomplete: ${style.reason}.`, cat.styles.filter((s) => s.available).map((s) => s.id)));
  }

  // lead character ('none' is an explicit, valid choice)
  let character = null;
  if (req('character')) {
    character = cat.characters.find((c) => c.id === input.character);
    if (!character) errors.push(err('character', `Unknown character "${input.character}".`, cat.characters.filter((c) => c.available).map((c) => c.id)));
    else if (!character.available) errors.push(err('character', `Character "${character.name}" cannot be rendered: ${character.reason}.`, cat.characters.filter((c) => c.available).map((c) => c.id)));
  }

  // duration
  let durationSeconds = null;
  if (req('durationSeconds')) {
    durationSeconds = Number(input.durationSeconds);
    if (!Number.isInteger(durationSeconds) || durationSeconds < cat.duration.min || durationSeconds > cat.duration.max) {
      errors.push(err('durationSeconds', `Target duration must be a whole number of seconds between ${cat.duration.min} and ${cat.duration.max}.`));
    }
  }
  let tolerance = cat.duration.tolerance;
  if (input.durationTolerance !== undefined) {
    const t = Number(input.durationTolerance);
    if (!Number.isFinite(t) || t < 0.03 || t > 0.25) errors.push(err('durationTolerance', 'Duration tolerance must be between 0.03 and 0.25 (3%–25%).'));
    else tolerance = t;
  }

  // visual mode
  let visualMode = null;
  if (req('visualMode')) {
    visualMode = cat.visualModes.find((m) => m.id === input.visualMode);
    if (!visualMode) errors.push(err('visualMode', `Unknown visual mode "${input.visualMode}".`, cat.visualModes.map((m) => m.id)));
    else if (!visualMode.available) errors.push(err('visualMode', `${visualMode.name} is unavailable: ${visualMode.reason}.`, cat.visualModes.filter((m) => m.available).map((m) => m.id)));
  }

  // engines the chosen purpose needs
  const E = cat.engines;
  const needsScriptModel = purpose === 'script' || !hasApprovedScript;
  if (needsScriptModel && !E.llm.ready) {
    errors.push(err('script', `Script generation needs the local script-writing model, which is not available: ${E.llm.reason}. ${purpose === 'render' ? 'Generate and approve a script first, or install the model.' : ''}`.trim()));
  }
  if (purpose === 'render') {
    if (!E.tts.ready) errors.push(err('engine', `Kokoro TTS unavailable: ${E.tts.reason}`));
    if (!E.chrome.ready) errors.push(err('engine', 'Google Chrome / Edge not found (needed for WebGL frame capture).'));
    if (!E.ffmpeg.ready) errors.push(err('engine', 'FFmpeg/FFprobe missing in runtime/ffmpeg/bin.'));
    if (!E.python.ready) errors.push(err('engine', 'Python environment missing in runtime/python-venv.'));
  }

  if (errors.length) return { ok: false, errors, warnings };

  const [w, h] = cat.output.resolution.split('x').map(Number);
  const config = {
    schema: 1,
    topic,
    language: { id: language.id, code: language.code, name: language.name, script: language.script, dialect: language.dialect, locale: language.locale, captionScript: language.captionScript, ttsScript: language.ttsScript },
    narration: {
      personality: personality.id, personalityName: personality.name, voice: voice.id, voiceName: `${voice.name} (${voice.accent}, ${voice.gender})`,
      voiceLanguage: voice.language, ttsLang: language.ttsLang || voice.language, speed,
      delivery: { ...personality.delivery, speed },
    },
    visual: {
      style: style.id, styleName: style.name, dimension: style.dimension, renderer: style.renderer,
      character: character.id, characterName: character.name, archetype: character.archetype,
      characterMode: character.id === 'none' ? 'none' : style.characterMode,
      visualMode: visualMode.id,
    },
    durationSeconds, durationTolerance: tolerance,
    resolution: `${w}x${h}`, width: w, height: h, fps: cat.output.fps,
    alignment: { engine: 'faster-whisper', model: language.alignmentModel, language: language.whisperLanguage },
  };
  if (style.dimension === '2d' && character.id !== 'none') warnings.push(`${style.name} is a 2D style: ${character.name} appears as a 2D figure in the character's registered colours, not as the 3D model.`);
  if (language.id === 'hinglish') warnings.push('Hinglish: captions are shown in Roman script; the Hindi voice reads a Devanagari version of each line.');
  return { ok: true, errors: [], warnings, config };
}

/** Fields that, when changed, make a previously generated script stale. */
export function scriptFingerprint(config) {
  const basis = { topic: config.topic.toLowerCase(), language: config.language.id, personality: config.narration.personality, duration: config.durationSeconds };
  return crypto.createHash('sha1').update(JSON.stringify(basis)).digest('hex').slice(0, 12);
}

export function configHash(config) {
  const { createdAt, ...rest } = config;
  return crypto.createHash('sha1').update(JSON.stringify(rest)).digest('hex').slice(0, 16);
}
