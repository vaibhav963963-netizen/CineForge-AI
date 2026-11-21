// Scene-to-visual intelligence: every narration line → a structured visual plan derived from what THAT line says
// (its English "visual" description first, then the narration), and a validation pass before rendering.
//
// Set-piece worlds (engine/runtime/src/director/setpieces{2d,3d}.js) are purpose-built animated scenes for subjects a
// stock environment cannot show (a protoplanetary disk, antibodies binding a virus, an octopus changing colour, light
// inside a raindrop). A world is chosen for the video when the topic and the lines are about it; each line then gets
// the ACTION its own words describe. Lines no world covers keep the existing environment pipeline, and the validator
// reports any shot whose picture does not come from its own line instead of passing it silently.

const W = (s) => new RegExp(s, 'i');
export const WORLDS = {
  cosmic: {
    environment: 'the early solar system',
    context: W('\\b(earth|planet\\w*|solar system|the sun|young sun|moon|nebula|protoplanet\\w*|planetesimal\\w*|asteroid\\w*|meteor\\w*|cosmos|universe|billion years)\\b|पृथ्वी|धरती|ग्रह|सूर्य|सौर|चंद्रमा|चाँद|ब्रह्मांड|नेबुला'),
    actions: [
      { id: 'impact', subject: 'two young planets', action: 'a Mars-sized body (Theia) strikes the young Earth; a flash and a spray of molten debris', objects: ['proto-Earth', 'Theia', 'debris'], re: W('\\btheia\\b|giant impact|impactor|collid\\w* with (the )?(early |young |proto-?)?earth|struck (the )?earth|smash\\w* into|टेया|थिया|टकराया|टकराव|टक्कर') },
      { id: 'compare', subject: 'the Earth and the Moon, cut open side by side', action: 'cutaways of both bodies show the same rocky mantle material', objects: ['Earth cutaway', 'Moon cutaway', 'mantle layers'], re: W('composition|similar (rock|material)|same (rock|material)|moon rocks?|mantle|side[- ]by[- ]side|compar\w*|संरचना|मिलती[- ‑]?जुलती|एक जैसी|तुलना|परतों') },
      { id: 'moon', subject: 'the young Earth and a forming Moon', action: 'a ring of debris circles the Earth and gathers into the Moon', objects: ['Earth', 'debris ring', 'Moon'], re: W('moon (form|was born|took shape)|forming the moon|formed (the|our) moon|debris (disk|ring|cloud).*(moon|coalesc)|coalesc\\w*.*moon|चंद्रमा का (निर्माण|जन्म)|चाँद (बना|का जन्म)') },
      { id: 'core', subject: 'a cross-section of the molten Earth', action: 'iron droplets sink through the mantle to the centre and form the core', objects: ['core', 'iron droplets'], re: W('\\biron\\b|\\bsink\\w*|\\bcore\\b|आयरन|लोहा|कोर|केंद्र में|भारी') },
      { id: 'molten', subject: 'the young molten Earth', action: 'a glowing ball of magma with volcanic eruptions', objects: ['magma ocean', 'volcanoes'], re: W('molten|magma|lava|volcan\\w*|red-?hot|hot young|fiery|metal|गर्मी|कोर|धातु|ऊर्जा|पिघल|लावा|ज्वालामुखी|मैग्मा|आग का गोला') },
      { id: 'collapse', subject: 'a dust cloud collapsing under its own gravity', action: 'the cloud contracts and flattens into a spinning disk', objects: ['dust cloud', 'young Sun'], re: W('collaps\w*|contract\w*|gravity|गुरुत्वाकर्षण|सिकुड़|गिरना|गिरने|गिरता|घूमने|घूम') },
      { id: 'disk', subject: 'a young Sun inside a disk of gas and dust', action: 'the disk rotates around the newborn Sun, inner rings faster', objects: ['young Sun', 'protoplanetary disk'], re: W('dust cloud|cosmic dust|swirling|धूल|\\bborn\\b|birth|origin|जन्म|protoplanetary|accretion disk|(gas and dust|dust and gas)|solar nebula|\\bnebula\\b|young sun|newborn sun|protostar|disk of (gas|dust)|गैस और धूल|धूल और गैस|नेबुला|धूल के बादल') },
      { id: 'accrete', subject: 'rocky planetesimals', action: 'dust and rocks collide and stick together, growing into larger bodies', objects: ['planetesimals', 'growing protoplanets'], re: W('(bodies|rocks|planetesimals|particles) (collid\w*|smash\w*|merg\w*)|collid\w*|planetesimal|accret\\w*|clump\\w*|particles? (collid|stick|join|clump)|stuck together|rocky bodies|grew (larger|bigger)|gravity pulled|छोटे-छोटे (टुकड़े|कण)|आपस में (जुड़|टकरा)|कण मिल') },
      { id: 'cooling', subject: 'the cooling young Earth', action: 'the glowing surface darkens into crust; steam rises and the first oceans spread', objects: ['crust', 'steam', 'first oceans'], re: W('cool(ed|ing|s)? (down)?|crust|first oceans?|oceans? (formed|appeared)|water (condensed|collected|vapou?r)|rain(ed)? for|ठंडी|ठंडा|ठंडे|पपड़ी|महासागर|समुद्र बन|पानी (जमा|बना)') },
      { id: 'atmosphere', subject: "the Earth's early atmosphere", action: 'a thin blue atmosphere and clouds wrap the planet', objects: ['atmosphere', 'clouds'], re: W('atmospher\\w*|\\bair\\b|clouds? (formed|covered)|gases (escaped|released)|वायुमंडल|वातावरण') },
      { id: 'life', subject: 'the blue Earth today, with its Moon', action: 'the finished blue planet turns slowly, the Moon beside it', objects: ['Earth', 'Moon'], re: W('\\blife\\b|living|thriving|blue planet|today|our (home|planet)|जीवन|आज|हमारा (घर|ग्रह)|नीला ग्रह') },
    ],
    overview: { id: 'life', subject: 'the Earth', action: 'the planet turns slowly in space', objects: ['Earth'] },
  },
  micro: {
    environment: 'inside the human bloodstream',
    context: W('\\b(vaccin\\w*|immun\\w*|antibod\\w*|antigen\\w*|virus\\w*|bacteri\\w*|pathogen\\w*|germs?|infection\\w*|white blood|b[- ]cells?|t[- ]cells?|memory cells?|booster)\\b|वैक्सीन|टीका|टीके|इम्यून|प्रतिरक्षा|एंटीबॉडी|वायरस|बैक्टीरिया|रोगाणु|कीटाणु|संक्रमण'),
    actions: [
      { id: 'herd', subject: 'a vaccinated community', action: 'most people are protected; the virus hops between them and cannot spread', objects: ['protected people', 'virus'], re: W('herd immunity|community|enough people|many people|most people|population|spread(ing)? (stops|slows)|हर्ड|बहुत (सारे )?लोग|ज़्यादा लोग|समुदाय|फैल नहीं') },
      { id: 'booster', subject: 'a booster dose', action: 'a second dose is injected and memory cells multiply', objects: ['syringe', 'memory cells'], re: W('booster|second dose|another dose|बूस्टर|दूसरी डोज़|दूसरा टीका') },
      { id: 'memory', subject: 'memory cells meeting the virus again', action: 'memory cells recognise the returning virus and antibodies swarm it fast', objects: ['memory cells', 'virus', 'antibodies'], re: W('memory (b |t )?cells?|remember\\w*|recogni[sz]\\w* (it )?(again|quickly|faster)|next time|second (time|encounter)|faster response|मेमोरी|याद (रख|रहता)|अगली बार|फिर से|तुरंत पहचान') },
      { id: 'tcell', subject: 'a T cell', action: 'a helper T cell moves in and joins the attack on the pathogen', objects: ['T cell', 'pathogen'], re: W('\\bt[- ]cells?\\b|helper|killer cells?|टी सेल') },
      { id: 'antibody', subject: 'antibodies and a pathogen', action: 'a B cell releases Y-shaped antibodies that latch onto the virus', objects: ['B cell', 'antibodies', 'virus'], re: W('antibod\\w*|\\bb[- ]cells?\\b|attack\\w*|fight\\w*|neutrali[sz]\\w*|bind\\w*|latch\\w*|एंटीबॉडी|बी सेल|हमला|लड़|दुश्मन|आक्रमणकारी|हमलावर') },
      { id: 'antigen', subject: 'harmless antigen pieces', action: 'weakened or inactive virus pieces drift toward an immune cell, which inspects them', objects: ['antigen pieces', 'immune cell'], re: W('weakened|inactiv\\w*|dead (virus|germ)|harmless|piece of|fragment|protein|antigen|mrna|blueprint|कमज़ोर|कमजोर|निष्क्रिय|मृत|हिस्सा|टुकड़ा|प्रोटीन') },
      { id: 'inject', subject: 'a vaccine injection', action: 'a syringe delivers the vaccine; antigen pieces enter the bloodstream', objects: ['syringe', 'antigen pieces'], re: W('inject\\w*|syringe|shot\\b|jab|dose|vaccinat\\w*|इंजेक्शन|टीका लग|डोज़|डोज') },
    ],
    overview: { id: 'antibody', subject: 'the immune system at work', action: 'an immune cell and antibodies around a virus in the bloodstream', objects: ['B cell', 'virus'] },
  },
  octopus: {
    environment: 'a coral reef on the sea floor',
    context: W('\\b(octop\\w*|cephalopod\\w*)\\b|ऑक्टोपस'),
    actions: [
      { id: 'camouflage', subject: 'an octopus on a rock', action: "the octopus changes its skin colour and texture until it blends into the rock", objects: ['octopus', 'rock'], re: W('camouflag\\w*|blend\\w*|chang\\w* (its )?(skin|colou?r|texture)|colou?r[- ]chang\\w*|disguis\\w*|invisible|रंग बदल|छिप|घुल-?मिल|त्वचा') },
      { id: 'squeeze', subject: 'an octopus and a narrow gap', action: 'the boneless octopus flattens and slips through a tiny opening', objects: ['octopus', 'narrow gap'], re: W('escap\\w*|squeez\\w*|narrow|tiny (hole|gap|opening)|through (a|the) (gap|hole|crack)|boneless|no bones|निकल (जा|भाग)|भाग (जा|निकल)|छोटे (छेद|से)|हड्डी नहीं') },
      { id: 'solve', subject: 'an octopus and a jar', action: 'the octopus wraps its arms around a jar and unscrews the lid to reach the crab inside', objects: ['octopus', 'jar', 'crab'], re: W('jar|lid|puzzle|problem|solv\\w*|unscrew\\w*|tool\\w*|open(s|ed|ing)? (a|the)|maze|coconut|क्लेवर|पहेली|ढक्कन|जार|हल कर|दिमाग़ से|दिमाग से') },
      { id: 'hearts', subject: "the octopus's three hearts", action: 'a cutaway: two gill hearts and one body heart pump blue blood', objects: ['branchial hearts', 'systemic heart', 'gills', 'blue blood'], re: W('hearts?|blood|gills?|hemocyanin|haemocyanin|copper|pump\\w*|oxygen|दिल|हार्ट|खून|ब्लड|गिल|ऑक्सीजन|पंप') },
      { id: 'swim', subject: 'a swimming octopus', action: 'the octopus jets through the water, arms trailing behind', objects: ['octopus'], re: W('swim\\w*|jet\\w*|tired|exhaust\\w*|crawl\\w*|तैर|थक') },
      { id: 'arms', subject: "the octopus's arms and neurons", action: 'glowing nerve signals run along the eight arms', objects: ['octopus', 'neurons'], re: W('neurons?|brain\\w*|intelligen\\w*|smart|arms? (can )?(think|taste|feel)|nine brains|दिमाग|न्यूरॉन|बुद्धि|होशियार') },
    ],
    overview: { id: 'overview', subject: 'an octopus on the reef', action: 'the octopus rests on the reef, arms moving', objects: ['octopus'] },
  },
  optics: {
    environment: 'rainy countryside and a raindrop close-up',
    context: W('\\b(rainbow\\w*|prism|refract\\w*|spectrum|raindrops?|droplets?)\\b|इंद्रधनुष'),
    actions: [
      { id: 'disperse', subject: 'light leaving a raindrop', action: 'white light splits into seven colours as it leaves the droplet', objects: ['raindrop', 'spectrum'], re: W('spectrum|split\\w* into|separat\\w* (into )?colou?rs|seven colou?rs|disper\\w*|leaves|exits?|spreading|violet|red, orange|सात रंग|रंगों में') },
      { id: 'reflect', subject: 'light inside a raindrop', action: 'the light reflects off the back of the droplet', objects: ['raindrop', 'light ray'], re: W('reflect\\w*|bounc\\w*|back of the (drop|droplet)|परावर्तन') },
      { id: 'refract', subject: 'light entering a raindrop', action: 'a white ray enters the droplet and bends', objects: ['raindrop', 'light ray'], re: W('refract\\w*|bend\\w*|enters?|prism|अपवर्तन|मुड़') },
      { id: 'sunrain', subject: 'sunlight and falling rain', action: 'the sun shines from behind the viewer onto falling rain', objects: ['sun', 'rain'], re: W('sunlight|sun (behind|shines)|rain(drops| falls|storm)?|after (the )?rain|धूप|बारिश') },
      { id: 'rainbow', subject: 'a rainbow over the countryside', action: 'a full rainbow arc fades in over the hills', objects: ['rainbow', 'hills'], re: W('rainbow|\\barc\\b|degrees?|angle|circle|इंद्रधनुष') },
    ],
    overview: { id: 'rainbow', subject: 'a rainbow', action: 'a rainbow arc over the hills', objects: ['rainbow'] },
  },
};
export const SETPIECE_WORLDS = Object.keys(WORLDS);

// worlds whose actions can include the lead character as an observer (it logically belongs in that place)
const LEAD_OK = { optics: new Set(['sunrain', 'rainbow']) };

/** the video's world: the one the topic names, else the one most lines are about (≥ half of them) */
export function chooseWorld(topic, lines) {
  const text = (l) => `${l.visual || ''} ${l.text || ''} ${l.say || ''}`;
  for (const [id, w] of Object.entries(WORLDS)) if (w.context.test(topic)) return id;
  const votes = Object.entries(WORLDS).map(([id, w]) => [id, lines.filter((l) => w.context.test(text(l)) || w.actions.some((a) => a.re.test(l.visual || ''))).length]).sort((a, b) => b[1] - a[1]);
  return votes[0] && votes[0][1] >= Math.ceil(lines.length / 2) ? votes[0][0] : null;
}

/**
 * the action a line shows inside the world: the English visual description is read first (it names the picture),
 * then the narration. Returns { ...action, matched: 'visual'|'narration'|'overview', keyword } or null.
 */
export function matchAction(worldId, line) {
  const w = WORLDS[worldId]; if (!w) return null;
  for (const [src, text] of [['visual', line.visual || ''], ['narration', `${line.text || ''} ${line.say || ''}`]]) {
    for (const a of w.actions) { const m = text.match(a.re); if (m) return { ...a, matched: src, keyword: m[0] }; }
  }
  if (w.context.test(`${line.visual || ''} ${line.text || ''} ${line.say || ''}`)) return { ...w.overview, matched: 'overview', keyword: null };
  return null;
}

const CAMERA = {
  collapse: 'wide, slow push-in as the cloud contracts', core: 'front-on cross-section, slow push', disk: 'wide, slow orbit around the young Sun', accrete: 'wide, slow lateral drift', impact: 'wide, slight push-in as the bodies meet', moon: 'high wide, easing down to the orbit plane',
  molten: 'medium, slow push toward the planet', cooling: 'medium, slow push', atmosphere: 'medium, three-quarter view of the limb', life: 'wide, gentle pull-back',
  inject: 'medium, the syringe enters from top right', antigen: 'medium, slow push toward the cell', antibody: 'medium, follows the antibodies to the virus', tcell: 'medium, static', memory: 'wide, static', booster: 'medium', herd: 'high angle over the crowd, slow drift',
  camouflage: 'medium close, slow arc', squeeze: 'three-quarter side view, tracks the octopus', solve: 'medium, over the jar', hearts: 'close cutaway, slow arc', swim: 'wide side tracking shot', arms: 'high angle, slow orbit', overview: 'medium, slow drift',
  sunrain: 'wide landscape, slow pan', refract: 'macro on the droplet, slow push', reflect: 'macro on the droplet', disperse: 'macro on the droplet, slight pull', rainbow: 'wide landscape, slow rise',
};
const LIGHT = {
  cosmic: { default: 'star light from the young Sun, deep space ambient', molten: 'emissive lava glow, red rim', cooling: 'dimming lava glow, cool sunlight', atmosphere: 'sunlight with blue atmospheric scattering' },
  micro: { default: 'soft key light through red plasma, cyan rim', herd: 'bright even daylight' },
  octopus: { default: 'sunlight filtered through water, caustic shafts, blue fog' },
  optics: { default: 'overcast daylight with the sun behind the viewer', refract: 'single white beam in darkness', reflect: 'single white beam in darkness', disperse: 'spectral beams in darkness' },
};

/** the structured visual plan of one shot */
export function visualPlan({ worldId, act, line, style, character, prev }) {
  const w = WORLDS[worldId];
  const leadOk = !!(LEAD_OK[worldId]?.has(act.id) && character && character !== 'none');
  return {
    subject: act.subject,
    environment: w.environment,
    action: act.action,
    supportingObjects: act.objects,
    visualDescription: String(line.visual || '').trim() || act.action,
    camera: CAMERA[act.id] || 'medium, slow drift',
    lighting: `${(LIGHT[worldId] || {})[act.id] || (LIGHT[worldId] || {}).default || 'style lighting'} · graded in the ${style.name} look`,
    animation: act.action,
    transition: prev && prev.world === worldId ? (prev.action === act.id ? 'continuous (same action continues)' : 'cut within the same set') : 'style transition into the set',
    continuity: `one shared ${worldId} set for the whole video${leadOk ? `; ${character} keeps the chosen look` : ''}`,
    leadAllowed: leadOk,
    matchedBy: act.matched, keyword: act.keyword,
  };
}

// ── validation before rendering ──────────────────────────────────────────────────────────────────────────
const GENERIC_ENVS = new Set(['studio', 'office', 'room', 'lab', 'night']);
const STOP = new Set('a an the of in on at with and or to from into its it is are was were his her their this that showing shot close up wide medium view scene camera slow animated animation illustration graphic diagram footage of'.split(' '));
const nouns = (s) => String(s || '').toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/).filter((x) => x.length > 3 && !STOP.has(x));

/**
 * Ten checks per shot (the task's checklist): represents the narration · subject present · action shown · environment
 * relevant · objects present · no contradiction · meaningful animation · continuity · style respected · complete.
 * A shot whose picture does not come from its own line FAILS — it is never passed silently.
 */
export function validateStoryboard(shots, lines, { style, world }) {
  let prevKey = null, prevWorld = null;
  const out = shots.map((s) => {
    const ls = s.lines.map((i) => lines[i]), vis = ls.map((l) => l.visual || '').join(' ');
    const issues = [], c = {};
    if (s.method === 'setpiece') {
      const p = s.visualPlan || {};
      c.representsNarration = p.matchedBy === 'visual' || p.matchedBy === 'narration';
      if (!c.representsNarration) issues.push(`shows the ${s.setpiece.world} set's general view: no specific action matched "${vis.slice(0, 80)}"`);
      c.subjectPresent = !!p.subject; c.actionShown = !!p.action; c.environmentRelevant = true; c.objectsPresent = (p.supportingObjects || []).length > 0;
      c.noContradiction = !(s.cast || []).some((x) => x.role === 'lead') || !!p.leadAllowed;
      if (!c.noContradiction) issues.push('the lead character is placed in a set where it does not belong');
    } else {
      // existing environment pipeline: the picture must come from this line (its visual named the place/objects)
      const fromLine = (s.concepts || []).length > 0, generic = GENERIC_ENVS.has(s.environment) && !(s.objects || []).length && !s.imagePrompt;
      c.representsNarration = !!s.imagePrompt || (fromLine && !generic);
      if (!c.representsNarration) issues.push(`no scene-specific visual: the line describes "${vis.slice(0, 90)}" but the shot is a generic ${s.environment} set`);
      // an AI image prompt must still name the line's own subject (the "abstract science → scientist in a lab" swap did not)
      if (s.imagePrompt) { const want = nouns(vis).slice(0, 6), got = s.imagePrompt.toLowerCase(); const kept = want.filter((n) => got.includes(n)); c.subjectPresent = !want.length || kept.length >= Math.min(2, want.length); if (!c.subjectPresent) issues.push(`the image prompt lost the line's subject (${want.slice(0, 4).join(', ')})`); }
      else c.subjectPresent = c.representsNarration;
      c.actionShown = !!(s.action || (s.cast || []).length || s.imagePrompt || (s.objects || []).length);
      c.environmentRelevant = !generic; c.objectsPresent = true; c.noContradiction = true;
    }
    const key = s.method === 'setpiece' ? `${s.setpiece.world}:${s.setpiece.action}:${(s.setpiece.range || [0, 1]).join('-')}` : `${s.environment}:${(s.objects || []).join(',')}:${s.imagePrompt || ''}`;
    c.meaningfulAnimation = key !== prevKey; if (!c.meaningfulAnimation) issues.push('repeats the previous shot\'s picture and animation');
    c.continuity = s.method !== 'setpiece' || !prevWorld || prevWorld === s.setpiece.world;
    c.styleRespected = !!style?.id; c.complete = !!s.method && s.end > s.start;
    prevKey = key; prevWorld = s.method === 'setpiece' ? s.setpiece.world : prevWorld;
    return { id: s.id, method: s.method, plan: s.method === 'setpiece' ? `${s.setpiece.world}/${s.setpiece.action}` : s.environment, checks: c, ok: issues.length === 0, issues };
  });
  return { ok: out.every((x) => x.ok), world, shots: out, failed: out.filter((x) => !x.ok).length };
}
