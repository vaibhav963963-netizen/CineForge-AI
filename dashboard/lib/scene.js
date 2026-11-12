// Scene construction: copies the shared studio runtime (engine/runtime) into a project, plus exactly the assets the
// selected style needs, and writes the files the runtime reads:
//   script.json          the approved narration lines (display text + spoken form + caption hints + pauses)
//   scenes/scene.json    style profile + character design + language + storyboard shots (timed)
//   index.html           fonts actually present + three.js import map for WebGL styles only
import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from './workspace.js';

const CORE3D = path.join(PATHS.styles, 'tall-tale', 'example');
const FONT_FILES = [
  { file: 'Inter-Black.otf', family: 'Inter', weight: 900 }, { file: 'Inter-ExtraBold.otf', family: 'Inter', weight: 800 },
  { file: 'Caladea-Bold.ttf', family: 'Caladea', weight: 700 }, { file: 'FreeMonoBold.ttf', family: 'FreeMono', weight: 700 },
];
function findStyleFont(file) {
  for (const s of fs.readdirSync(PATHS.styles)) { const f = path.join(PATHS.styles, s, 'example', 'fonts', file); if (fs.existsSync(f)) return f; }
  return null;
}
function devanagariFont() {
  try { const f = fs.readdirSync(PATHS.fonts).find((x) => /devanagari.*\.(ttf|otf)$/i.test(x)); return f ? path.join(PATHS.fonts, f) : null; } catch { return null; }
}

/** colours + accessories of each 3D archetype, read from the character asset itself (character3d.js) */
export function archetypeDesigns() {
  const src = fs.readFileSync(path.join(CORE3D, 'src', 'core', 'character3d.js'), 'utf8');
  const block = src.slice(src.indexOf('export const ARCHETYPES'), src.indexOf('export function createCharacter3D'));
  const out = {};
  for (const m of block.matchAll(/^ {2}([a-z_]+): \{([\s\S]*?)^ {2}\}/gm)) {
    const body = m[2], d = {};
    for (const f of body.matchAll(/(\w+): '([^']*)'/g)) d[f[1]] = f[2];
    const acc = body.match(/accessories: \[([^\]]*)\]/); d.accessories = acc ? [...acc[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
    out[m[1]] = d;
  }
  return out;
}

export function characterSpec(config, catalogChar) {
  if (config.visual.character === 'none') return { id: 'none', mode: 'none' };
  const base = archetypeDesigns()[config.visual.archetype], ov = config.visual.lookOverrides || {};
  const d = base ? { ...base, ...ov, accessories: ov.accessories || base.accessories } : base;
  if (!d) throw new Error(`3D design for "${config.visual.archetype}" not found in character3d.js`);
  const accessory = d.hairStyle === 'turban' ? 'turban' : d.hairStyle === 'bun' ? 'bun' : d.accessories.includes('cap') ? 'cap' : d.accessories.includes('headphones') ? 'headphones' : d.accessories.includes('glasses') ? 'glasses' : 'none';
  return {
    id: config.visual.character, name: config.visual.characterName, archetype: config.visual.archetype, mode: config.visual.characterMode,
    colors: { skin: d.skin, shirt: d.shirt, vest: d.vest, pants: d.pants, hair: d.hairColor, accent: d.vest && d.vest !== d.shirt ? d.vest : (catalogChar?.accentColor || d.trim), accent2: d.trim },
    accessory, attire: catalogChar?.attire || null, look: config.visual.look || null, lookName: config.visual.lookName || null, lookOverrides: config.visual.lookOverrides || null,
  };
}

function copyDir(src, dst) { fs.cpSync(src, dst, { recursive: true, force: true }); }

/** copy the runtime + style assets into the project and write index.html. Returns the inventory of what was copied. */
export function scaffoldRuntime(dir, config) {
  const style = config.visual.style, webgl = config.visual.renderer === 'webgl';
  copyDir(path.join(PATHS.runtimeTemplate, 'src'), path.join(dir, 'src'));
  copyDir(path.join(PATHS.runtimeTemplate, 'tools'), path.join(dir, 'tools'));
  const inventory = { runtime: 'engine/runtime', style, renderer: config.visual.renderer, fonts: [], threeJs: null, characterAsset: null };
  if (webgl) {
    copyDir(path.join(CORE3D, 'vendor'), path.join(dir, 'vendor'));
    for (const f of ['engine.js', 'character3d.js', 'environments3d.js']) fs.copyFileSync(path.join(CORE3D, 'src', 'core', f), path.join(dir, 'src', 'core', f));
    inventory.threeJs = 'three.js r170 (MIT)'; inventory.characterAsset = 'engine/styles/tall-tale/example/src/core/character3d.js';
  } else {
    // 2D styles never load WebGL code
    fs.rmSync(path.join(dir, 'src', 'director', 'stage3d.js'), { force: true });
  }
  fs.mkdirSync(path.join(dir, 'fonts'), { recursive: true });
  const faces = [];
  for (const F of FONT_FILES) { const src = findStyleFont(F.file); if (src) { fs.copyFileSync(src, path.join(dir, 'fonts', F.file)); faces.push({ ...F, url: `fonts/${F.file}` }); inventory.fonts.push(F.file); } }
  const deva = devanagariFont();
  if (deva) { const name = 'StudioDeva' + path.extname(deva); fs.copyFileSync(deva, path.join(dir, 'fonts', name)); faces.push({ file: name, family: 'StudioDeva', weight: '100 900', url: `fonts/${name}`, sample: 'अ' }); inventory.fonts.push(`${path.basename(deva)} → ${name}`); }
  if (config.language.captionScript === 'Deva' && !deva) throw new Error('Devanagari captions need a Devanagari font in assets/fonts');
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${style}</title>
<style>
${faces.map((f) => `@font-face { font-family: '${f.family}'; font-weight: ${f.weight}; src: url('${f.url}'); }`).join('\n')}
html, body { margin: 0; background: #111; height: 100%; } body { display: flex; align-items: center; justify-content: center; }
#cv { display: block; height: 100vh; width: auto; } body.capture #cv { height: auto; } #gl { display: none; }
#play { position: fixed; font: 900 28px Inter, sans-serif; padding: 18px 36px; border: 0; border-radius: 40px; background: #FFD43B; cursor: pointer; }
</style></head>
<body>
<canvas id="cv" width="1080" height="1920"></canvas><canvas id="gl" width="1080" height="1920"></canvas>
<button id="play" hidden>▶ PLAY</button>
<script>if (location.search.includes('capture')) document.body.className = 'capture';</script>
${webgl ? '<script type="importmap">{"imports":{"three":"./vendor/three.module.js","three/addons/":"./vendor/addons/"}}</script>\n' : ''}<script type="module" src="src/main.js"></script>
</body></html>
`;
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  return { inventory, fonts: faces.map((f) => ({ family: f.family, weight: typeof f.weight === 'number' ? f.weight : 800, sample: f.sample || 'A' })) };
}

/** the narration script the runtime + voice.py + words.py read */
export function writeRuntimeScript(dir, script, config) {
  const d = config.narration.delivery;
  const out = {
    title: script.title, language: config.language.id, voice: config.narration.voice, speed: config.narration.speed,
    lead: d.lead, outro: d.outro, gap: d.gap,
    lines: script.lines.map((l) => ({ text: l.text, ...(l.say ? { say: l.say } : {}), ...(l.caps ? { caps: l.caps } : {}), ...(l.gap !== undefined ? { gap: l.gap } : {}) })),
  };
  fs.writeFileSync(path.join(dir, 'script.json'), JSON.stringify(out, null, 2));
  return out;
}

export function writeScene(dir, { config, style, character, storyboard, fonts }) {
  const scene = {
    schema: 1, title: storyboard.title, style, fonts, music: style.music,
    language: { id: config.language.id, code: config.language.code, captionScript: config.language.captionScript },
    character, targetSeconds: config.durationSeconds,
    shots: storyboard.shots.map((s) => ({ ...s, image: s.image || null })),
  };
  fs.writeFileSync(path.join(dir, 'scenes', 'scene.json'), JSON.stringify(scene, null, 2));
  return scene;
}
