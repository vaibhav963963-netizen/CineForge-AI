import { devanagariToHinglish, skeleton } from './translit.js';

// Visual-semantic intelligence (Step 6). VALIDATION (visualReport) is separate from CORRECTION (correctVisuals).
// Neither ever changes the narration, the approved script text or the research facts.
//
// Every scene (one per narration line) is traced to its narration reference — the English story-plan beat, the English
// draft line, the line itself (English) or its declared English words (Hinglish), plus the fact-file English keys of
// Hindi terms the line contains — and checked in seven explainable categories:
//   alignment · facts · history · science · diversity · continuity · completeness
// severity: error (wrong / misleading → never READY) · review (uncertain → NEEDS_REVIEW) · warning (advisory)
//
// Root cause of the old gate failing almost every script: it demanded an exact word of the line in the visual
// ("the line is about uttarapath, the visual shows an ancient road"). Alignment now accepts words the FACT FILE uses
// together with the line's term (Uttarapath → "ancient trade route") and a small table of general synonyms.

const STOP = new Set('the a an and or of to in on at is are was were be been it its this that these those for with by as from has have had into onto than then so but their his her they them which who what when there here also about over under after before while such very more most some many much other only just can could would should will may might do does did not no its out up down off one two three'.split(' '));
const FRAMING = new Set('shot close closeup close-up wide medium extreme aerial view angle low high slow motion time lapse timelapse scene image picture photo photograph illustration diagram animation animated render rendering rendered stylized detailed showing shows show showcasing highlighting depicting depicted representing visible background foreground frame camera focus focusing subtle dramatic vibrant cinematic gentle gently slightly large small big tiny macro overhead side front top bottom left right centre center light lighting dark bright soft warm cool colour color style realistic 3d 2d graphic graphics motion text label labels arrow arrows split screen'.split(' '));
const tok = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).map((w) => w.replace(/'s$/, '').replace(/^'+|'+$/g, '')).filter((w) => w.length > 2 && !STOP.has(w));
// plural/verb endings: "planes" → "plane" (not "plan"), "studies" → "study"
const stem = (w) => w.replace(/ies$/, 'y').replace(/(?<![su])s$/, '').replace(/(ing|ed)$/, '').slice(0, 6);
const content = (s) => tok(s).filter((w) => !FRAMING.has(w));

// general synonyms (not topic facts): a visual may show the thing under another everyday name
const RELATED = [
  ['road', 'route', 'highway', 'path', 'street', 'trail', 'track', 'way'], ['ship', 'vessel', 'boat', 'sailing'], ['plane', 'aircraft', 'airplane', 'aeroplane', 'flight'],
  ['heart', 'cardiac', 'hearts'], ['blood', 'bloodstream', 'circulation', 'vessels', 'artery', 'arteries', 'veins'], ['gill', 'gills'], ['moon', 'lunar'], ['earth', 'planet', 'globe'],
  ['sun', 'solar', 'sunlight'], ['sea', 'ocean', 'water', 'waves', 'marine'], ['city', 'cities', 'town', 'settlement', 'ruins', 'ruin'], ['king', 'emperor', 'ruler', 'sultan', 'monarch'],
  ['vaccine', 'vaccination', 'injection', 'syringe', 'shot'], ['cell', 'cells', 'cellular'], ['germ', 'virus', 'bacteria', 'pathogen', 'microbe'], ['antibody', 'antibodies'],
  ['storm', 'hurricane', 'cyclone', 'thunderstorm', 'rain', 'wind', 'waves', 'turbulent', 'weather'], ['study', 'studies', 'research', 'researchers', 'scientists', 'data', 'survey'], ['compass', 'needle', 'magnetic'], ['rain', 'monsoon', 'rainfall'], ['drought', 'dry', 'cracked'], ['river', 'stream', 'current'],
  ['traveller', 'travellers', 'traveler', 'travelers', 'merchant', 'merchants', 'caravan'], ['rest', 'inn', 'sarai', 'caravanserai'], ['rocket', 'launch', 'launcher'], ['orbit', 'orbiting'],
];
const REL = new Map(); for (const g of RELATED) for (const w of g) REL.set(stem(w), new Set([...(REL.get(stem(w)) || []), ...g.map(stem)]));

const PEOPLE_V = /\b(young (boy|girl|man|woman)|(a|an|the) (boy|girl|child|kid|man|woman|person|family|couple)|children|kids|crowd of people|group of (people|friends|students)|tourists|onlookers)\b/i;
const PEOPLE_R = /\b(people|person|scientists?|engineers?|astronomers?|king|emperor|ruler|rulers|travell?ers?|merchants?|soldiers?|workers|farmers|villagers|citizens|crowd|children|students|he|she|they|his|her|their|we|you|our|doctor|patient|pilots?|sailors?|crew|jenner|kipling|shah)\b/i;
const STOCK = /\b(smiling (man|woman|person|face|people)|happy (man|woman|person|people)|busy street|movie poster|film poster|stock (photo|image)|generic|abstract background|person thinking|presenter|host talking|thumbs up)\b/i;
// history
const ERA = [
  ['ancient', /\b(ancient|bce|b\.c\.|bronze age|harappa\w*|mohenjo|indus|vedic|maurya\w*|pharaoh|roman empire)\b|\b[1-3]\d{3} bce\b/i],
  ['medieval', /\b(medieval|mughal|sultanate|sher shah|1[0-7]th century|1[0-7]\d{2}\b|sarai|caravanserai|fort)\b/i],
  ['colonial', /\b(british raj|colonial|victorian|east india company|18th century|19th century|18\d{2})\b/i],
  ['modern', /\b(today|modern|present[- ]day|nowadays|20th century|21st century|19[5-9]\d|20[0-4]\d)\b/i],
];
const eraOf = (s) => ERA.filter(([, re]) => re.test(String(s || ''))).map(([e]) => e);
const MODERN_OBJ = /\b(smartphones?|phones?|laptops?|computers?|digital tablets?|tablet computers?|ipads?|cars?|trucks?|buses|bus|highways?|asphalt|skyscrapers?|neon|drones?|airplanes?|aeroplanes?|helicopters?|television|tv screen|led|plastic|electric (lights?|poles?)|power lines?|wristwatch|jeans|t-shirts?|sneakers|hoodie|suit and tie|concrete tower|traffic lights?|satellite dish)\b/i;
// science / medicine
const NUMW = { one: 1, single: 1, a: 1, an: 1, two: 2, both: 2, pair: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const HUMAN_ANATOMY = /\bhuman (heart|hearts|chest|body|anatomy|lungs?|ribcage|torso|skeleton|organs?)\b/i;
const GORE = /\b(gore|gory|blood-soaked|bloody|graphic surgery|corpse|dead bodies|dying|terrif\w+|horror|screaming|needle piercing)\b/i;
const MEDICAL = /\b(vaccin\w*|virus|disease|immune|infect\w*|blood|surgery|patient|medicine|health|antibod\w*)\b/i;
const CAMERA = /^(extreme close-up|close-up|closeup|macro|medium shot|medium|wide shot|wide|aerial|overhead|low angle|high angle|diagram|animated diagram|animation|split screen|cutaway|map)/i;
const COLOURS = /\b(red|blue|green|yellow|black|white|brown|grey|gray|orange|purple|pink|golden)\b/i;
const CHAR = /\b(boy|girl|man|woman|narrator|character|scientist|king|sailor|pilot|student|doctor)\b/i;

const counts = (s) => {   // "three hearts" → Map(heart → 3)
  const m = new Map(), w = String(s || '').toLowerCase().replace(/[^\w\s-]/g, ' ').split(/\s+/);
  for (let i = 0; i < w.length - 1; i++) { const n = /^\d{1,2}$/.test(w[i]) && +w[i] <= 20 ? +w[i] : NUMW[w[i]]; /* small counts only, never years */ if (!n) continue; const noun = [w[i + 1], w[i + 2]].find((x) => x && !FRAMING.has(x) && !STOP.has(x) && x.length > 2); if (noun) m.set(stem(noun), { n, word: noun, article: w[i] === 'a' || w[i] === 'an' }); }
  return m;
};

/** the English reference a scene is checked against, with where it came from */
export function sceneReference(value, i, topicFacts = null) {
  const l = value.script.lines[i] || {}, m = value.meta || {}, parts = [];
  const beat = m.plan?.beats?.length === value.script.lines.length ? m.plan.beats[i] : null;
  const draft = m.englishDraft?.lines?.length === value.script.lines.length ? m.englishDraft.lines[i] : null;
  if (draft) parts.push(['English draft', typeof draft === 'string' ? draft : draft.text]);
  if (beat) parts.push(['story plan', typeof beat === 'string' ? beat : beat.point]);
  if (/[a-z]{3}/i.test(l.text || '') && !/[ऀ-ॿ]/.test(l.text || '')) parts.push(['narration', l.text]);
  if (Array.isArray(l.english) && l.english.length) parts.push(['English words of the line', l.english.join(' ')]);
  const hi = String(l.say || l.text || '');
  const terms = Object.entries(topicFacts?.terms?.hi || {}).filter(([, v]) => String(v).split('(')[0].trim().split(/\s+/).every((w) => w && hi.includes(w))).map(([k]) => k);
  if (terms.length) parts.push(['fact-file terms in the line', terms.join(' ')]);
  return { text: parts.map((p) => p[1]).join(' '), sources: parts.map((p) => p[0]) };
}

/**
 * Validation only. Returns { scenes:[{ sceneId, line, narration, reference, visual, findings:[{category, problem,
 * severity, evidence, recommendation}], decision }], categories:{name:{ok, issues}}, ok }.
 */
export function visualReport(config, value, { topicFacts = null, storyKind = null } = {}) {
  const lines = value.script.lines, shots = value.meta?.visuals?.shots?.length === lines.length ? value.meta.visuals.shots : null;
  const topicW = new Set(content(config.topic).map(stem));
  const verified = (topicFacts?.verified || []).map((v) => (typeof v === 'string' ? v : v.text));
  const known = new Set([...content(verified.join(' ')), ...content((topicFacts?.aliases || []).join(' ')), ...content(config.topic)].map(stem));
  const scenes = lines.map((l, i) => {
    const ref = sceneReference(value, i, topicFacts), v = String(l.visual || '').trim(), f = [];
    const add = (category, problem, severity, evidence = null, recommendation = null) => f.push({ category, problem, severity, evidence, recommendation });
    // completeness
    if (!v) add('completeness', 'no visual for this scene', 'error', null, 'describe the picture for this line');
    else if (content(v).length < 2) add('completeness', `the visual names almost nothing ("${v}")`, 'review', null, 'name the subject, its action and the setting');
    if (!ref.text.trim()) add('completeness', 'no narration reference to check this scene against (no English plan beat, draft or English words)', 'review', null, 'review the scene by hand');
    const V = new Set(content(v).map(stem)), Vall = new Set([...V, ...content(`${shots?.[i]?.subject || ''} ${shots?.[i]?.action || ''}`).map(stem)]);
    const R = content(ref.text), Rs = new Set(R.map(stem));
    if (v && ref.text.trim()) {
      // alignment
      if (STOCK.test(v) && !STOCK.test(ref.text)) add('alignment', `stock/unrelated imagery ("${v.match(STOCK)[0]}")`, 'error', null, 'show the line\'s own subject');
      if (PEOPLE_V.test(v) && !PEOPLE_R.test(ref.text)) add('alignment', `shows people the line is not about ("${v.match(PEOPLE_V)[0]}")`, 'review', `narration: "${ref.text.slice(0, 120)}"`, 'show the subject itself, not onlookers');
      const specific = [...new Set(R.filter((w) => !topicW.has(stem(w))))];
      // expansion: everyday synonyms + words the fact file uses in the same sentence as the line's term
      const ok = new Set();
      for (const w of specific) { ok.add(stem(w)); for (const r of REL.get(stem(w)) || []) ok.add(r); for (const s of verified.filter((x) => x.toLowerCase().includes(w))) for (const c of content(s)) ok.add(stem(c)); }
      const hit = [...Vall].some((w) => ok.has(w) || topicW.has(w));
      if (specific.length && !hit) add('alignment', `the visual does not show what the line is about (${specific.slice(0, 4).join(', ')})`, 'review', `narration (${ref.sources.join(' + ')}): "${ref.text.slice(0, 140)}"`, `show ${specific.slice(0, 2).join(' / ')}`);
      // unsupported visual claims: numbers or proper names the narration and sources do not contain
      const vn = (v.match(/\b\d[\d,.]*\b/g) || []).filter((n) => !ref.text.includes(n) && !verified.join(' ').includes(n));
      if (vn.length) add('facts', `the visual adds numbers the narration does not say (${vn.join(', ')})`, 'review', null, 'remove them');
      // proper names: a multi-word capitalised name anywhere after the first word ("Lady Mary Wortley Montagu"), or one
      // capitalised word right after a lowercase word (not after punctuation, where "The", "Sunlight" start a phrase)
      // names may be in the narration only in Devanagari ("अटलांटिक"): compare consonant outlines of the romanised line
      const lineSk = new Set(devanagariToHinglish(lines.map((y) => String(y.say || y.text || '')).join(' ')).toLowerCase().split(/[^a-z]+/).filter((x) => x.length > 2).map(skeleton));
      // a name is supported when one of its DISTINCTIVE words (not River/Ocean/North/Lady…) is in the narration, the
      // sources or the whole script (romanised): "North Atlantic Ocean" ← "Atlantic"; a name made only of generic
      // geography words ("Valley", "Ocean") is not a claim at all
      const GENERIC_NAME = /^(Earth|Moon|Sun|India|Indian|River|Valley|Island|Islands|Desert|Coast|Bay|Gulf|Mountains|Plains|Basin|North|South|East|West|Northern|Southern|Upper|Lower|Great|Old|New|Lady|Lord|Sir|King|Queen|Saint|St|Mount|Lake|Ocean|Sea)$/;
      const unsupportedName = (n) => { const d = n.split(/\s+/).filter((x) => !GENERIC_NAME.test(x)); return d.length > 0 && !d.some((x) => Rs.has(stem(x.toLowerCase())) || known.has(stem(x.toLowerCase())) || lineSk.has(skeleton(x.toLowerCase()))); };
      const names = [...(v.match(/(?<=[a-z,]\s)(?!The\b|A\b|An\b)[A-Z][a-z]+(?:\s[A-Z][a-z]+)+/g) || []), ...(v.match(/(?<=[a-z]\s)(?!The\b|A\b|An\b)[A-Z][a-z]{2,}\b(?!\s[A-Z])/g) || [])].filter((n) => !unsupportedName(n) ? false : true);
      if (names.length) add('facts', `the visual names ${names.join(', ')}, which neither the narration nor the sources mention`, 'review', null, 'show only people and places the narration names');
      // facts: a known error of this topic shown in the picture
      for (const e of topicFacts?.knownErrors || []) for (const k of e.keys || []) if (/^[\x00-\x7f]+$/.test(k) && k.length > 3 && v.toLowerCase().includes(k.toLowerCase())) add('facts', `the visual shows a known error: "${e.text}"`, 'error', e.correction || null, e.correction ? `follow the source: ${e.correction}` : null);
      // history
      const historical = storyKind === 'history' || eraOf(ref.text).some((e) => e !== 'modern');
      if (historical) {
        const timeShift = /\b(today|now|modern|nowadays|present[- ]day)\b/i.test(ref.text);
        const mo = v.match(MODERN_OBJ);
        if (mo && !timeShift) add('history', `period mismatch — a historical line shown with "${mo[0]}"`, 'error', `narration: "${ref.text.slice(0, 120)}"`, `remove "${mo[0]}"; show period-correct objects`);
        const re = eraOf(ref.text).filter((e) => e !== 'modern'), ve = eraOf(v).filter((e) => e !== 'modern');
        if (re.length && ve.length && !ve.some((e) => re.includes(e))) add('history', `wrong era — the line is ${re.join('/')}, the visual is ${ve.join('/')}`, 'error', `narration: "${ref.text.slice(0, 120)}"`, `show the ${re[0]} period`);
      }
      // science
      const rc = counts(ref.text), vc = counts(v);
      for (const [k, x] of vc) { const r = rc.get(k); if (r && r.n !== x.n && !(x.article && r.n > 1 && /\b(one of|each)\b/i.test(v))) add('science', `count mismatch — the line says ${r.n} ${r.word}, the visual shows ${x.n}`, 'error', `narration: "${ref.text.slice(0, 120)}"`, `show ${r.n} ${r.word}`); }
      if (HUMAN_ANATOMY.test(v) && !/\b(human|person|people|patient|man|woman|our|your|we)\b/i.test(`${ref.text} ${config.topic}`)) add('science', `human anatomy shown for a non-human subject ("${v.match(HUMAN_ANATOMY)[0]}")`, 'error', `topic: "${config.topic}"`, 'show the anatomy of the subject the line is about');
      if (GORE.test(v) && MEDICAL.test(`${ref.text} ${config.topic}`)) add('science', `sensational medical imagery ("${v.match(GORE)[0]}")`, 'warning', null, 'use a calm, explanatory visual (diagram, close-up)');
    }
    const sev = f.some((x) => x.severity === 'error') ? 'error' : f.some((x) => x.severity === 'review') ? 'review' : f.length ? 'warning' : 'ok';
    return { sceneId: `S${i + 1}`, line: i + 1, narration: String(l.say || l.text || ''), reference: ref, visual: v, findings: f, decision: sev === 'error' ? 'misleading — not ready' : sev === 'review' ? 'needs review' : 'aligned' };
  });
  // diversity + continuity (across scenes)
  const W = lines.map((l) => new Set(content(l.visual).map(stem)));
  const push = (i, category, problem, severity, recommendation) => scenes[i].findings.push({ category, problem, severity, evidence: null, recommendation });
  for (let i = 0; i < W.length; i++) for (let j = i + 1; j < W.length; j++) {
    const inter = [...W[i]].filter((w) => W[j].has(w)).length, uni = new Set([...W[i], ...W[j]]).size;
    if (uni >= 5 && inter / uni >= 0.75) push(j, 'diversity', `nearly the same visual as scene S${i + 1}`, 'review', 'show the next step of the story, or change the shot');
  }
  const cams = lines.map((l) => (String(l.visual || '').match(CAMERA)?.[1] || '').toLowerCase().replace(/^closeup$/, 'close-up').replace(/ shot$/, ''));
  for (let i = 2; i < cams.length; i++) if (cams[i] && cams[i] === cams[i - 1] && cams[i] === cams[i - 2]) push(i, 'diversity', `third "${cams[i]}" in a row`, 'warning', 'vary the composition where the story allows (wide → close-up → diagram)');
  const eras = lines.map((l, i) => ({ v: eraOf(l.visual).filter((e) => e !== 'modern'), r: scenes[i].reference.text }));
  for (let i = 1; i < eras.length; i++) if (eras[i].v.length && eras[i - 1].v.length && !eras[i].v.some((e) => eras[i - 1].v.includes(e)) && !/\b(later|after|centuries|years|today|then|by \d|in \d{3,4})\b/i.test(eras[i].r)) push(i, 'continuity', `the period jumps from ${eras[i - 1].v[0]} to ${eras[i].v[0]} without the narration moving in time`, 'warning', 'keep the period unless the story moves on');
  const look = new Map();
  lines.forEach((l, i) => { const v = String(l.visual || ''); const c = v.match(CHAR), col = v.match(COLOURS); if (c && col && v.toLowerCase().indexOf(col[0].toLowerCase()) - v.toLowerCase().indexOf(c[0].toLowerCase()) < 40) { const k = c[0].toLowerCase(), p = look.get(k); if (p && p.col !== col[0].toLowerCase()) push(i, 'continuity', `the ${k} changes appearance (${p.col} in S${p.i + 1}, ${col[0].toLowerCase()} here)`, 'review', `keep the ${k}'s look consistent`); else if (!p) look.set(k, { col: col[0].toLowerCase(), i }); } });
  for (const s of scenes) { const sev = s.findings.some((x) => x.severity === 'error') ? 'error' : s.findings.some((x) => x.severity === 'review') ? 'review' : s.findings.length ? 'warning' : 'ok'; s.decision = sev === 'error' ? 'misleading — not ready' : sev === 'review' ? 'needs review' : 'aligned'; }
  const CATS = ['alignment', 'facts', 'history', 'science', 'diversity', 'continuity', 'completeness'];
  const categories = Object.fromEntries(CATS.map((c) => { const fs = scenes.flatMap((s) => s.findings.filter((x) => x.category === c).map((x) => ({ ...x, sceneId: s.sceneId }))); const bad = fs.filter((x) => x.severity !== 'warning'); return [c, { ok: !bad.length, issues: bad.map((x) => `${x.sceneId}: ${x.problem}`), advisory: fs.filter((x) => x.severity === 'warning').map((x) => `${x.sceneId}: ${x.problem}`) }]; }));
  return { scenes, categories, ok: Object.values(categories).every((c) => c.ok) };
}

/**
 * Correct only scenes with an error or review finding (except diversity warnings): one model request per scene that
 * receives the narration READ-ONLY, the problem and the evidence, and returns ONE new visual sentence. The new visual is
 * re-validated with visualReport; it is kept only if that scene has no error/review finding left and no other scene got
 * a new one. The narration is never written. Returns { value, log, calls }.
 */
export async function correctVisuals(config, value, { chatFn, signal, topicFacts = null, storyKind = null, maxCalls = 4 } = {}) {
  const before = visualReport(config, value, { topicFacts, storyKind }), log = [];
  let cur = value, calls = 0;
  const bad = (rep, i) => rep.scenes[i].findings.filter((x) => x.severity === 'error' || x.severity === 'review');
  for (const s of before.scenes) {
    const i = s.line - 1, problems = bad(before, i);
    if (!problems.length) continue;
    if (!chatFn || calls >= maxCalls) { log.push({ sceneId: s.sceneId, accepted: false, reason: calls >= maxCalls ? 'correction limit reached — needs review' : 'no model' }); continue; }
    if (!s.reference.text.trim()) { log.push({ sceneId: s.sceneId, accepted: false, reason: 'no narration reference — needs review' }); continue; }
    calls++;
    const schema = { type: 'object', properties: { visual: { type: 'string', maxLength: 220 } }, required: ['visual'], additionalProperties: false };
    const sys = ['You write ONE English sentence describing the picture for one scene of a vertical YouTube Short. Start with the shot type (Wide shot of / Close-up of / Diagram of …).',
      'The picture must show exactly what the narration says — its subject, action and setting — and nothing it does not say: no extra people, numbers, names or claims. Keep the science and the historical period right. You never change the narration. Output ONLY JSON.'].join('\n');
    const user = `Topic: ${config.topic}\nNARRATION (read-only): ${s.reference.text}\nCURRENT VISUAL: ${s.visual}\nPROBLEMS: ${problems.map((p) => `${p.problem}${p.evidence ? ` (${p.evidence})` : ''}${p.recommendation ? ` → ${p.recommendation}` : ''}`).join('; ')}`;
    const entry = { sceneId: s.sceneId, from: s.visual, problems: problems.map((p) => p.problem) };
    try {
      const { text, truncated } = await chatFn({ messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], schema, temperature: 0.2, maxTokens: 160, signal });
      const nv = String(JSON.parse(text)?.visual || '').trim();
      if (truncated || !nv || /[ऀ-ॿ]/.test(nv)) { log.push({ ...entry, accepted: false, reason: truncated ? 'cut off' : !nv ? 'empty' : 'not English' }); continue; }
      const trial = { ...cur, script: { ...cur.script, lines: cur.script.lines.map((l, k) => (k === i ? { ...l, visual: nv } : l)) } };
      const after = visualReport(config, trial, { topicFacts, storyKind }), rem = bad(after, i);
      const others = after.scenes.some((x, k) => k !== i && bad(after, k).length > bad(visualReport(config, cur, { topicFacts, storyKind }), k).length);
      const why = rem.length ? `still: ${rem.map((p) => p.problem).join('; ')}` : others ? 'it creates a problem in another scene' : null;
      log.push({ ...entry, to: nv, accepted: !why, ...(why ? { reason: why } : {}) });
      if (!why) cur = trial;
    } catch (e) { if (signal?.aborted) throw e; log.push({ ...entry, accepted: false, reason: `no valid answer (${String(e.message).slice(0, 80)})` }); }
  }
  // the narration is never changed by a visual correction
  cur.script.lines.forEach((l, k) => { if ((l.text !== value.script.lines[k].text) || (l.say !== value.script.lines[k].say)) throw new Error('visual correction changed the narration'); });
  return { value: cur, log, calls };
}
