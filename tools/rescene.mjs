// Dev tool: re-plan the storyboard and rebuild the scene for an existing project from its saved narration timing,
// then render a contact sheet (no TTS / alignment / full capture). For iterating on visuals.
//   node tools/rescene.mjs <projectId> [--style <id>] [--character <id>] [--step 1]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectDir, loadProject } from '../dashboard/lib/projects.js';
import { getCatalog } from '../dashboard/lib/catalog.js';
import { validateGenerationConfig } from '../dashboard/lib/validate.js';
import { inputFromConfig } from '../dashboard/lib/pipeline.js';
import { planStoryboard } from '../dashboard/lib/storyboard.js';
import { scaffoldRuntime, characterSpec, writeScene } from '../dashboard/lib/scene.js';
import { childEnv, PATHS } from '../dashboard/lib/workspace.js';

const id = process.argv[2], opt = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const p = loadProject(id); if (!p) throw new Error(`no project ${id}`);
const input = { ...inputFromConfig(p.config), ...(opt('--style') ? { style: opt('--style') } : {}), ...(opt('--character') ? { character: opt('--character') } : {}) };
const v = validateGenerationConfig(input, { purpose: 'render', hasApprovedScript: true });
if (!v.ok) throw new Error(JSON.stringify(v.errors));
const config = v.config, dir = projectDir(id), cat = getCatalog(true), style = cat.styles.find((s) => s.id === config.visual.style);
const script = JSON.parse(fs.readFileSync(path.join(dir, 'script.json'), 'utf8'));
const timing = JSON.parse(fs.readFileSync(path.join(dir, 'audio', 'lines.json'), 'utf8')), words = JSON.parse(fs.readFileSync(path.join(dir, 'audio', 'words.json'), 'utf8'));
const visuals = (() => { const v = p.script.approvedVersion && JSON.parse(fs.readFileSync(path.join(dir, 'script', `v${String(p.script.approvedVersion).padStart(3, '0')}.json`), 'utf8')); return v ? v.lines : script.lines; })();
const sb = planStoryboard({ script: { title: script.title, lines: script.lines.map((l, i) => ({ ...l, visual: visuals[i]?.visual, onScreen: visuals[i]?.onScreen })) }, timing, words, config, style, topic: config.topic });
for (const s of sb.shots) console.log(s.id, s.start.toFixed(1).padStart(5), s.method.padEnd(11), s.environment.padEnd(9), JSON.stringify(s.cast), s.objects.join(','), `${s.camera.angle}/${s.camera.move}`, s.overlay ? s.overlay.type : '');
const { fonts } = scaffoldRuntime(dir, config);
writeScene(dir, { config, style, character: characterSpec(config, cat.characters.find((c) => c.id === config.visual.character)), storyboard: sb, fonts });
const env = childEnv({ FFMPEG: PATHS.ffmpeg });
const out = `review/rescene-${config.visual.style}.jpg`;
const r = spawnSync(process.execPath, ['tools/capture.mjs', 'sheet', out, opt('--step') || '1', '8'], { cwd: dir, env, encoding: 'utf8' });
console.log((r.stdout || '').split('\n').filter((l) => !l.startsWith('@@')).join('\n'), r.stderr || '');
console.log(path.join(dir, out));
