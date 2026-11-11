// Storyboard planning: narration lines (+ their real TTS/Whisper times) → timed shots, each with a visual objective,
// subject, environment, objects, action, camera, lighting, rendering method, image prompt, 3D asset needs,
// animation instructions and transition. Matching uses each line's English "visual" description (written by the
// script model, editable in the preview) and the narration itself through an English + Devanagari + Hinglish lexicon,
// so the picture follows what is being said instead of one character talking for the whole video.

// concept → triggers (lower-case substrings; Devanagari included) and what it implies on screen
const CONCEPTS = [
  { id: 'cricket', env: 'cricket', subject: 'a cricket match', words: ['cricket', 'batsman', 'batter', 'bowler', 'wicket', 'stumps', 'innings', 'gully cricket', 'sixer', 'boundary', 'pitch', 'क्रिकेट', 'बल्लेबाज', 'गेंदबाज', 'विकेट', 'छक्का', 'मैच', 'chakka', 'ballebaaz'] },
  { id: 'batting', objects: ['bat', 'ball'], action: 'bat_swing', words: ['bat ', 'bat,', 'bat.', 'batting', 'batsman', 'hits a', 'hit the ball', 'sixer', 'six!', 'helicopter shot', 'बल्ला', 'बल्लेबाज', 'छक्का', 'शॉट', 'balla'] },
  { id: 'bowling', objects: ['ball'], extra: { action: 'bowl', position: 'bowler' }, words: ['bowl', 'bowler', 'delivery', 'yorker', 'गेंदबाज', 'गेंद', 'gend'] },
  { id: 'launch', env: 'launchpad', objects: ['rocket'], shotAction: 'launch', subject: 'a rocket launch', words: ['launch', 'lift-off', 'liftoff', 'blast off', 'pslv', 'gslv', 'sriharikota', 'rocket', 'लॉन्च', 'प्रक्षेपण', 'रॉकेट', 'उड़ान भरी'] },
  { id: 'space', env: 'space', subject: 'outer space', words: ['space', 'orbit', 'mars', 'planet', 'moon', 'galaxy', 'star', 'solar', 'astronaut', 'mangalyaan', 'chandrayaan', 'isro', 'nasa', 'अंतरिक्ष', 'मंगल', 'ग्रह', 'कक्षा', 'चाँद', 'चंद्र', 'इसरो', 'mangal', 'antariksh'] },
  { id: 'satellite', objects: ['satellite'], words: ['satellite', 'orbiter', 'spacecraft', 'probe', 'mangalyaan', 'उपग्रह', 'यान', 'मंगलयान', 'orbiter'] },
  { id: 'orbit', overlay: { type: 'orbit' }, words: ['orbit', 'trajectory', 'slingshot', 'hohmann', 'कक्षा', 'transfer orbit'] },
  { id: 'money', env: 'office', objects: ['coins'], words: ['money', 'budget', 'cost', 'crore', 'lakh', 'million', 'billion', 'dollar', 'rupee', '₹', '$', 'cheap', 'expensive', 'paisa', 'पैसा', 'बजट', 'करोड़', 'लाख', 'रुपये', 'डॉलर', 'खर्च', 'सस्ता', 'महंगा', 'kharcha', 'sasta'] },
  { id: 'movie', env: 'studio', objects: ['film', 'camera'], words: ['hollywood', 'movie', 'film', 'cinema', 'gravity', 'studio', 'फ़िल्म', 'फिल्म', 'हॉलीवुड', 'सिनेमा'] },
  { id: 'temple', env: 'temple', subject: 'an Indian temple', words: ['temple', 'mandir', 'puja', 'pooja', 'prayer', 'deity', 'shrine', 'मंदिर', 'पूजा', 'प्रार्थना', 'देवता'] },
  // a bell being mentioned is not a bell being rung: only ringing words make the character ring it
  { id: 'bell', objects: ['bell'], words: ['bell', 'ghanti', 'घंटी', 'घंटा', 'घंटियाँ', 'chime'] },
  { id: 'ringing', action: 'ring_bell', shotAction: 'swing', words: ['ringing', 'rings', 'ring the', 'ring a', 'rang', 'swinging', 'बजाते', 'बजाएँ', 'बजाएं', 'बजाना', 'बजाई', 'बजाया', 'बजती', 'बजते', 'बजता', 'bajate', 'bajao'] },
  { id: 'history', env: 'palace', subject: 'a historic Indian fort', objects: ['crown'], words: ['king', 'emperor', 'fort', 'palace', 'maharaj', 'empire', 'dynasty', 'kingdom', 'ancient', 'raja', 'shivaji', 'mughal', 'maratha', 'राजा', 'किला', 'महल', 'साम्राज्य', 'शिवाजी', 'प्राचीन', 'इतिहास', 'qila'] },
  { id: 'science', env: 'lab', subject: 'a science lab', objects: ['atom'], words: ['science', 'scientist', 'experiment', 'lab', 'research', 'physics', 'chemistry', 'molecule', 'विज्ञान', 'वैज्ञानिक', 'प्रयोग', 'शोध', 'vigyan'] },
  { id: 'brain', objects: ['brain'], words: ['brain', 'mind', 'neuron', 'memory', 'दिमाग', 'मस्तिष्क', 'dimaag'] },
  { id: 'body', env: 'lab', objects: ['dna'], words: ['body', 'blood', 'cell', 'dna', 'gene', 'heart', 'शरीर', 'खून', 'कोशिका'] },
  { id: 'tech', env: 'office', objects: ['laptop'], words: ['computer', 'software', 'internet', 'ai ', 'artificial intelligence', 'app', 'code', 'chip', 'robot', 'startup', 'tech', 'कंप्यूटर', 'इंटरनेट', 'सॉफ्टवेयर', 'टेक'] },
  { id: 'phone', objects: ['phone'], words: ['phone', 'mobile', 'smartphone', 'फ़ोन', 'फोन', 'मोबाइल'] },
  { id: 'business', env: 'office', objects: ['chart'], words: ['company', 'business', 'founder', 'investor', 'market', 'profit', 'revenue', 'shares', 'कंपनी', 'बिज़नेस', 'बिजनेस', 'मुनाफा', 'निवेश'] },
  { id: 'bank', env: 'city', objects: ['bank'], words: ['bank', 'बैंक'] },
  { id: 'city', env: 'city', subject: 'an Indian city', words: ['city', 'mumbai', 'delhi', 'bengaluru', 'traffic', 'building', 'skyscraper', 'शहर', 'मुंबई', 'दिल्ली', 'इमारत'] },
  { id: 'street', env: 'street', subject: 'an Indian street', words: ['street', 'gully', 'gali', 'lane', 'mohalla', 'colony', 'गली', 'मोहल्ला', 'सड़क'] },
  { id: 'village', env: 'village', subject: 'an Indian village', words: ['village', 'farmer', 'farm', 'field', 'crop', 'harvest', 'monsoon', 'गाँव', 'गांव', 'किसान', 'खेत', 'फसल', 'kisan', 'gaon'] },
  { id: 'mountains', env: 'mountains', subject: 'snowy Himalayan mountains and a frozen lake', words: ['mountain', 'himalaya', 'glacier', 'glacial', 'snow', 'frozen', 'peak', 'lake', 'shore', 'valley', 'पहाड़', 'हिमालय', 'बर्फ़', 'बर्फ', 'झील', 'ग्लेशियर'] },
  { id: 'nature', env: 'nature', subject: 'nature', words: ['river', 'forest', 'tree', 'ocean', 'sea', 'nature', 'नदी', 'जंगल', 'समुद्र', 'प्रकृति'] },
  { id: 'home', env: 'room', subject: 'a home', words: ['home', 'house', 'family', 'mother', 'father', 'room', 'घर', 'परिवार', 'माँ', 'पापा', 'ghar'] },
  { id: 'skeleton', objects: ['skull'], words: ['skeleton', 'skeletons', 'skull', 'bones', 'bone ', 'remains', 'कंकाल', 'हड्डी', 'हड्डियाँ', 'खोपड़ी'] },
  { id: 'mystery', env: 'night', subject: 'a dark mysterious place', words: ['mystery', 'crime', 'police', 'detective', 'secret', 'missing', 'night', 'dark', 'ghost', 'रहस्य', 'अपराध', 'पुलिस', 'रात', 'अंधेरा', 'गुप्त', 'raaz'] },
  { id: 'time', objects: ['clock'], words: ['minutes', 'hours', 'seconds', 'deadline', 'time', 'मिनट', 'समय', 'waqt'] },   // no 'घंटे' (hours): its stem collides with घंटी (bell)
  { id: 'idea', objects: ['bulb'], action: 'think', words: ['idea', 'plan', 'genius', 'smart', 'trick', 'jugaad', 'think', 'thinking', 'thinks', 'wonder', 'imagine', 'socho', 'आइडिया', 'योजना', 'तरकीब', 'जुगाड़', 'सोचो', 'सोचिए', 'कल्पना'] },
  { id: 'question', objects: ['question'], action: 'think', words: ['why', 'how', 'what if', 'ever wondered', 'kya aapko', 'kyun', 'kaise', 'क्यों', 'कैसे', 'क्या आपको', 'क्या आप'] },
  { id: 'win', action: 'celebrate', objects: ['trophy'], extra: { action: 'celebrate' }, words: ['success', 'won', 'victory', 'record', 'first time', 'first try', 'history was made', 'made history', 'champion', 'celebrat', 'proud', 'सफल', 'सफलता', 'जीत', 'रिकॉर्ड', 'पहली बार', 'इतिहास रच'] },
  { id: 'india', exact: true, objects: ['flag'], words: ['india', 'bharat', 'भारत', 'हिंदुस्तान'] },
  { id: 'shock', action: 'shock', words: ['shocking', 'unbelievable', 'surprising', 'but here', 'twist', 'हैरान', 'चौंक', 'यकीन नहीं', 'अविश्वसनीय', 'lekin', 'लेकिन'] },
  { id: 'journey', action: 'walk', words: ['journey', 'travel', 'walked', 'road to', 'सफ़र', 'सफर', 'यात्रा'] },
  { id: 'explain', action: 'explain', words: ['because', 'reason', 'actually', 'the secret', 'the trick', 'here is how', 'क्योंकि', 'वजह', 'असल में', 'राज़', 'असली'] },
  { id: 'people', extra: { action: 'explain' }, words: ['scientists', 'engineers', 'team', 'people', 'crowd', 'वैज्ञानिकों', 'इंजीनियर', 'टीम', 'लोग'] },
  { id: 'crowd', extra: { action: 'walk' }, words: ['busy', 'crowd', 'crowded', 'rush', 'भीड़', 'भीड़-भाड़'] },
];
const ACTION_ENV_OK = { bat_swing: ['cricket', 'street', 'village', 'nature'], ring_bell: ['temple'], bowl: ['cricket', 'street'] };
const SPACE_OK = new Set(['satellite', 'rocket', 'earth', 'mars', 'moon', 'sun', 'planet_earth', 'planet_mars']);
const GENERIC_ENVS = new Set(['office', 'studio', 'lab', 'room']);
const PERSON_RE = /\b(engineers?|scientists?|students?|man|men|woman|women|boys?|girls?|kids?|children|people|farmers?|teachers?|players?|batsman|bowler|devotees?|guards?|rangers?|person|family|crowd|he|she)\b/i;
/** concepts ordered by where the text first mentions them ("a flag waving, a scientist celebrating" → flag first) */
function byMention(cs, text) {
  const t = ` ${String(text || '').toLowerCase()} `;
  const pos = (c) => Math.min(...c.words.map((w) => { const m = t.match(matcher(w) instanceof RegExp ? matcher(w) : null); return m ? m.index : t.indexOf(w.trim()) >= 0 ? t.indexOf(w.trim()) : 1e9; }));
  return cs.map((c) => [pos(c), c]).sort((a, b) => a[0] - b[0]).map(([, c]) => c);
}
const PHYSICAL = new Set(['bat_swing', 'bowl', 'walk', 'run', 'ring_bell', 'launch', 'swing']);

// Latin keywords match whole words (so "king" does not fire inside "thinking"); keywords ending in a space or
// punctuation are prefixes ("bat " / "celebrat"); Devanagari keywords match as substrings (Hindi inflects by suffix).
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MATCHERS = new Map();
function matcher(w) {
  if (!MATCHERS.has(w)) {
    const core = w.trim(), latin = /^[\x00-\x7F]+$/.test(w) && /[a-z]/i.test(core);
    MATCHERS.set(w, latin ? new RegExp(`(^|[^a-z0-9])${esc(core)}${/[a-z]$/.test(w) && !w.endsWith(' ') && core.length > 5 ? '' : '(?![a-z0-9])'}`, 'i') : { test: (t) => t.includes(core) });
  }
  return MATCHERS.get(w);
}
const has = (text, w) => matcher(w).test(text);
// Matching is word-based, never raw substring: "ध्यान" (attention) must not match "यान" (spacecraft), "bat" must not
// match "combat". A single-word trigger matches a token that STARTS with it (Hindi inflections: घंटी → घंटियाँ);
// concepts marked exact need the whole token (the adjective "Indian" is not the subject "India").
const TOKEN_SPLIT = /[^\p{L}\p{M}\p{N}₹$%]+/u;
export function analyze(text) {
  const raw = String(text || '').toLowerCase().normalize('NFC');
  const tokens = raw.split(TOKEN_SPLIT).filter(Boolean), joined = ` ${tokens.join(' ')} `;
  const hit = (c, w) => {
    const ww = w.trim().toLowerCase().normalize('NFC');
    if (!ww) return false;
    if (/[^\p{L}\p{M}\p{N}]/u.test(ww) && !/\s/.test(ww)) return raw.includes(ww);          // symbols like ₹ / $
    if (/\s/.test(ww)) return joined.includes(` ${ww.split(TOKEN_SPLIT).filter(Boolean).join(' ')} `);   // phrases
    // Devanagari inflection changes the final vowel sign (घंटी → घंटियाँ, बल्ला → बल्ले): match on the stem
    const stem = /[ऀ-ॿ]/.test(ww) ? ww.replace(/[ा-ौँं]+$/u, '') : ww;
    const s = stem.length >= 3 ? stem : ww;
    return tokens.some((t) => (c.exact ? t === ww : t.startsWith(s)));
  };
  return CONCEPTS.filter((c) => c.words.some((w) => hit(c, w)));
}
// when several concepts imply an environment, the most specific wins
// "night" is a mood (dark alley), not a place: any concrete place in the line wins over it
const ENV_RANK = { cricket: 9, temple: 9, mountains: 8, launchpad: 8, space: 7, palace: 7, lab: 6, village: 6, city: 5, street: 5, nature: 4, room: 4, office: 3, night: 2, studio: 1 };
const bestEnv = (cs) => cs.filter((c) => c.env).sort((a, b) => (ENV_RANK[b.env] || 0) - (ENV_RANK[a.env] || 0))[0];

// ── numbers, money, years → overlays ───────────────────────────────────────────────────────────────────────
const UNIT_RE = /((?:₹|\$|rs\.?\s?)?\s?\d[\d,]*(?:\.\d+)?\s?(?:%|crore|cr\b|करोड़|lakh|लाख|million|mn\b|m\b|मिलियन|billion|bn\b|b\b|बिलियन|thousand|k\b|हज़ार|हजार|km|किलोमीटर|days|दिन|years|साल|minutes|मिनट)?)/gi;
export function findNumbers(text) {
  const out = [];
  for (const m of String(text || '').matchAll(UNIT_RE)) {
    const v = m[1].trim(); if (!/\d/.test(v)) continue;
    const n = parseFloat(v.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(n)) continue;
    const year = /^\d{4}$/.test(v) && n >= 1000 && n <= 2100;
    out.push({ value: v, n, year });
  }
  return out;
}

function overlayFor(line, concepts) {
  if (line.onScreen) {
    const nums = findNumbers(line.onScreen);
    if (nums.length >= 2 && /vs|बनाम|\||<|>/i.test(line.onScreen)) {
      const parts = line.onScreen.split(/\s+(?:vs\.?|बनाम)\s+|\s*[|<>]\s*/i).filter(Boolean).slice(0, 3);
      return { type: 'comparison', items: parts.map((p) => { const n = findNumbers(p)[0]; return { label: p.replace(n?.value || '', '').trim() || p, value: n ? n.n : 1, display: n ? n.value : p }; }) };
    }
    if (nums.length === 1 && nums[0].year) return { type: 'date', text: line.onScreen };
    if (nums.length >= 1) return { type: 'number', value: nums[0].value, label: line.onScreen.replace(nums[0].value, '').trim() || null };
    return { type: 'label', text: line.onScreen };
  }
  const nums = findNumbers(line.text).filter((x) => x.n > 0);
  const money = nums.filter((x) => /₹|\$|crore|करोड़|lakh|लाख|million|मिलियन|billion|बिलियन/i.test(x.value));
  if (money.length >= 2) return { type: 'comparison', items: money.slice(0, 2).map((x) => ({ label: x.value, value: x.n, display: x.value })) };
  if (money.length === 1) return { type: 'number', value: money[0].value, label: null };
  const yr = nums.find((x) => x.year);
  if (yr) return { type: 'date', text: yr.value };
  if (concepts.some((c) => c.id === 'orbit')) return { type: 'orbit', labels: null };
  return null;
}

const ANGLE_CYCLE = ['medium', 'wide', 'close', 'low', 'medium', 'high', 'medium', 'wide'];

/**
 * @param script      { title, lines: [{ text, say?, visual?, onScreen? }] }
 * @param timing      audio/lines.json { duration, lines: [{ start, end }] }
 * @param words       audio/words.json [{ w, line, s, e }]
 * @param config      validated generation config
 * @param style       style profile
 * @returns storyboard { title, version, planner, shots: [...] }
 */
export function planStoryboard({ script, timing, words, config, style, topic }) {
  const lines = script.lines, T = timing.lines, dur = timing.duration;
  const topicConcepts = analyze(`${topic} ${script.title} ${lines.map((l) => l.visual || '').join(' ')}`);
  // the story's home environment = the one most lines point to (ties → the more specific one)
  const votes = {};
  for (const l of lines) { const e = bestEnv(analyze(`${l.visual || ''} ${l.text} ${l.say || ''}`)); if (e) votes[e.env] = (votes[e.env] || 0) + 1; }
  const voted = Object.entries(votes).sort((a, b) => b[1] - a[1] || (ENV_RANK[b[0]] || 0) - (ENV_RANK[a[0]] || 0))[0];
  const topicEnv = voted ? voted[0] : ((bestEnv(topicConcepts) || {}).env || (style.id === 'night-file' ? 'night' : 'studio'));
  const hasLead = config.visual.character !== 'none', is3d = style.renderer === 'webgl', hybrid = config.visual.visualMode === 'hybrid-local';
  const minShot = style.pacing.minShot, maxShot = style.pacing.maxShot;

  // 1. group lines into beats (merge very short lines, split long ones at a word boundary)
  const beats = [];
  for (let i = 0; i < lines.length; i++) {
    const s = T[i].start, e = T[i].end;
    const prev = beats[beats.length - 1];
    if (prev && (e - prev.start) <= maxShot && (prev.end - prev.start) < minShot) { prev.lines.push(i); prev.end = e; continue; }
    // a line that carries an on-screen fact is never split: the overlay must stay readable for the whole line
    const ov = overlayFor(lines[i], analyze(`${lines[i].visual || ''} ${lines[i].text}`)), carriesOverlay = !!ov && ['comparison', 'orbit', 'route'].includes(ov.type);
    if (e - s > maxShot * 1.1 && !carriesOverlay) {
      const ws = words.filter((w) => w.line === i), mid = (s + e) / 2;
      const cut = ws.reduce((b, w) => (Math.abs(w.s - mid) < Math.abs(b - mid) ? w.s : b), mid);
      beats.push({ lines: [i], start: s, end: cut, part: 0 }); beats.push({ lines: [i], start: cut, end: e, part: 1 });
    } else beats.push({ lines: [i], start: s, end: e });
  }

  // 2. plan each beat
  let leadShots = 0, lastEnv = null, imageShots = 0, lastOverlayType = null, lastHadLead = false, spaceCount = 0;
  const shots = beats.map((b, k) => {
    const ls = b.lines.map((i) => lines[i]);
    const narration = ls.map((l) => l.text).join(' ');
    const visualText = ls.map((l) => l.visual || '').join(' ');
    const concepts = analyze(`${visualText} ${narration} ${ls.map((l) => l.say || '').join(' ')}`);
    const fromVisual = byMention(analyze(visualText), visualText);   // in the order the visual description names them
    const pick = (f) => (fromVisual.find(f) || concepts.find(f));
    // the first concrete place the visual names wins ("a busy street outside a temple" → street); mood-only settings
    // (night/office/studio, rank < 4) are used only when no concrete place is named
    const namedPlace = fromVisual.find((c) => c.env && (ENV_RANK[c.env] || 0) >= 4);
    let env = (namedPlace || bestEnv(fromVisual) || bestEnv(concepts) || {}).env || topicEnv;
    const isEnd0 = k === beats.length - 1;
    // a person in the visual can't be shown floating in space: if only the narration said "space", stay on the ground
    if (env === 'space' && !bestEnv(fromVisual) && PERSON_RE.test(visualText)) env = 'lab';
    // the payoff shows the story's hero subject in its home environment, not a generic office/studio
    // (only when the visual itself names no place; a person can't stand in space, so a space story ends at the launch pad)
    if (isEnd0 && GENERIC_ENVS.has(env) && !GENERIC_ENVS.has(topicEnv) && !bestEnv(fromVisual)) env = topicEnv === 'space' && PERSON_RE.test(visualText) ? 'launchpad' : topicEnv;
    const actionC = pick((c) => c.action), shotActionC = pick((c) => c.shotAction);
    let action = actionC ? actionC.action : null;
    if (action && ACTION_ENV_OK[action] && !ACTION_ENV_OK[action].includes(env)) env = ACTION_ENV_OK[action][0];
    let objects = [...new Set([...fromVisual, ...concepts].flatMap((c) => c.objects || []))];
    if (env === 'space') { objects = objects.filter((o) => SPACE_OK.has(o)); if (!objects.length) objects = ['satellite']; }
    if (env === 'launchpad' && !objects.includes('rocket')) objects.unshift('rocket');
    objects = objects.slice(0, 3);
    let spaceView = null;
    if (env === 'space') { const t = ` ${visualText} ${narration} ${ls.map((l) => l.say || '').join(' ')} `.toLowerCase(); spaceView = /mars|मंगल|mangal|reach|arriv|पहुँच|insertion/.test(t) ? 'mars' : /earth|धरती|पृथ्वी|circl|चक्कर|launch|left earth/.test(t) ? 'earth' : (spaceCount++ % 2 ? 'transfer' : 'mars'); if (b.part === 1) spaceView = spaceView === 'mars' ? 'transfer' : 'mars'; if (isEnd0) spaceView = 'mars'; }
    const extras = env === 'space' ? [] : concepts.filter((c) => c.extra).map((c) => ({ role: 'extra', ...c.extra })).slice(0, 2);
    let overlay = b.part ? null : overlayFor(ls[0], concepts);
    if (!overlay && ls[1]) overlay = overlayFor(ls[1], concepts);
    // never the same diagram twice in a row: the second beat shows the scene itself
    if (overlay && overlay.type === lastOverlayType && ['orbit', 'comparison', 'route'].includes(overlay.type)) overlay = null;
    const physical = PHYSICAL.has(action) || PHYSICAL.has(shotActionC?.shotAction);
    const isHook = k === 0, isEnd = k === beats.length - 1;

    // the lead character is the storyteller: hook, reactions, explanations, physical actions and the payoff, and
    // otherwise about every other shot — but never floating in space or standing in front of a rocket launch
    let leadAction = null;
    if (hasLead && env !== 'space' && shotActionC?.shotAction !== 'launch') {
      const reacts = ['shock', 'think', 'explain', 'celebrate', 'walk'].includes(action);
      const named = PERSON_RE.test(visualText);   // the visual description names a person: show the character
      const wantsLead = isHook || isEnd || physical || reacts || named || !lastHadLead;
      const budgetOk = leadShots < Math.max(2, Math.ceil(beats.length * 0.65)) || isEnd || (named && physical);
      if (wantsLead && budgetOk) leadAction = action || (isHook ? 'point' : isEnd ? 'celebrate' : ['explain', 'point', 'talk'][k % 3]);
    }
    if (leadAction) leadShots++;
    lastHadLead = !!leadAction;
    const cast = [...(leadAction ? [{ role: 'lead', action: leadAction, position: env === 'cricket' && leadAction === 'bat_swing' ? 'lead' : undefined }] : []), ...extras];
    if (action === 'bat_swing' && !cast.some((c) => c.action === 'bowl') && env === 'cricket' && !b.part) cast.push({ role: 'extra', action: 'bowl', position: 'bowler' });

    // rendering method (a diagram replaces the scene only when no character is acting in it)
    let method;
    if (overlay && ['comparison', 'orbit'].includes(overlay.type) && !leadAction) method = 'infographic';
    else if (physical || cast.some((c) => c.role === 'lead' && PHYSICAL.has(c.action))) method = is3d ? 'scene3d' : 'scene2d';
    else if (hybrid && (b.part || !leadAction) && imageShots < Math.ceil(beats.length * 0.55)) method = 'image';
    else if (hybrid && leadAction && !physical && k % 3 === 1) method = 'hybrid';
    else method = is3d ? 'scene3d' : 'scene2d';
    if (method === 'image' || method === 'hybrid') imageShots++;

    const moves = style.camera.moves;
    const camera = {
      angle: isHook ? (leadAction ? 'medium' : 'wide') : isEnd ? 'wide' : physical ? (k % 2 ? 'wide' : 'medium') : env === 'space' ? 'wide' : ANGLE_CYCLE[k % ANGLE_CYCLE.length],
      move: isHook ? (moves.includes('punch') ? 'punch' : 'push') : isEnd ? (moves.includes('pull') ? 'pull' : moves.includes('crane') ? 'crane' : moves[0]) : moves[k % moves.length],
    };
    if (env !== lastEnv && !isHook && !physical && moves.includes('crane')) camera.move = 'crane';
    if (leadAction && overlay && ['comparison', 'orbit', 'number'].includes(overlay.type)) camera.angle = 'wide';   // room for the overlay above the character
    // nothing to frame up close (no character, no props): show the place, never a medium shot of a bare wall
    if (!leadAction && !objects.length && !overlay && ['medium', 'close', 'low', 'ots'].includes(camera.angle)) { camera.angle = 'wide'; if (camera.move === 'punch') camera.move = 'push'; }
    lastEnv = env; lastOverlayType = overlay ? overlay.type : null;

    const subjectC = pick((c) => c.subject);
    const subject = leadAction ? `${config.visual.characterName} (${leadAction.replace('_', ' ')})` : objects[0] ? objects[0].replace('_', ' ') : (subjectC ? subjectC.subject : env);
    const vis = visualText.trim() || `${subjectC ? subjectC.subject : env}${objects.length ? ' with ' + objects.join(', ') : ''}`;
    const imagePrompt = method === 'image' || method === 'hybrid'
      ? `${vis}, ${style.image.prompt}${method === 'hybrid' ? ', empty background plate, no people in the foreground' : ''}`
      : null;
    const tr = isHook ? 'black' : style.transition.type;
    return {
      id: 'S' + String(k + 1).padStart(2, '0'),
      lines: b.lines, start: +(k === 0 ? 0 : Math.max(0, b.start - 0.08)).toFixed(3), end: +(k === beats.length - 1 ? dur : Math.max(0, beats[k + 1].start - 0.08)).toFixed(3),
      narration: b.part === undefined ? narration : `${narration} (part ${b.part + 1}/2)`,
      visualObjective: vis.slice(0, 200),
      subject, environment: env, objects, action: shotActionC?.shotAction || null,
      cast, camera, lighting: style.lighting.mood, visualStyle: style.name,
      method, renderMethod: { scene3d: '3D environment + animated 3D character/props (Three.js)', scene2d: `2D ${style.name} drawing + animated figure/props`, image: 'Local AI image (ComfyUI) + camera move', hybrid: is3d ? 'Local AI image backdrop + live 3D character (parallax)' : 'Local AI image + 2D figure', infographic: 'Animated infographic over defocused environment' }[method],
      imagePrompt, negativePrompt: imagePrompt ? style.image.negative : null, image: null,
      assets3d: is3d && method !== 'image' ? { environment: env, props: objects, actors: cast.map((c) => (c.role === 'lead' ? config.visual.archetype : 'generic extra')) } : null,
      animation: [...cast.map((c) => `${c.role === 'lead' ? config.visual.characterName : 'extra'}: ${c.action}`), ...(shotActionC ? [`scene: ${shotActionC.shotAction}`] : []), `camera: ${camera.angle} ${camera.move}`].join('; '),
      overlay, transition: tr, concepts: concepts.map((c) => c.id), spaceView,
      focus: env === 'temple' && !leadAction && concepts.some((c) => c.id === 'bell' || c.id === 'ringing') ? 'bell' : undefined,
    };
  });
  return { title: script.title, planner: 'rules+lexicon v1', createdAt: new Date().toISOString(), durationSeconds: dur, shots };
}
