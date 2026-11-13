// The production pipeline. Every stage is real work reported through the job (no invented percentages); child
// processes are asynchronous; the job is completed only after the final MP4 exists, FFprobe verified it, the export
// copy in <workspace>/exports was verified and QA ran.
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, childEnv, rel, CHROME } from './workspace.js';
import { getCatalog, whisperFor } from './catalog.js';
import { validateGenerationConfig, scriptFingerprint, configHash } from './validate.js';
import { projectDir, loadProject, updateProject, addScriptVersion, getScriptVersion, approveScriptVersion } from './projects.js';
import { generateScript, checkLanguage, estimateSeconds, recordVoiceRate, countWords } from './scriptgen.js';
import { planStoryboard } from './storyboard.js';
import { scaffoldRuntime, characterSpec, writeRuntimeScript, writeScene } from './scene.js';
import { generateImage, seedFor, freeVram, readImageIndex, writeImageIndex } from './imagegen.js';
import { stopServer as stopLLM } from './llm.js';
import { imageStats, judgeImage, judgeShots, autoLevel } from './exposure.js';
import { claimsGate } from './factcheck.js';
import { run } from './proc.js';

// Stage weights: proportional to measured wall-clock time on the reference machine (i5-12450H + RTX 3050 6 GB)
// for a ~40 s short; see logs/jobs/*.json "stages" for the timings they were derived from.
// Measured mean share of wall-clock time over 8 completed renders (logs/jobs, Nov 10): capture 45.9 %, align 18.6 %,
// tts 15.8 %, qa 9.1 %, audio 5.5 %, scene 4.4 %, compose 0.6 %. images ≈ 22 s per hi-res image (≈ 6 per video);
// local script generation 20–60 s including model load. Tiny stages keep weight 1 so their completion is visible.
export const WEIGHTS = { validate: 1, scriptGenerate: 16, scriptLoad: 1, prepare: 1, tts: 16, align: 18, storyboard: 1, images: 40, scene: 5, capture: 44, audio: 5, compose: 1, qa: 9 };

export function renderPlan({ approved, hybrid }) {
  return [
    { id: 'validate', weight: WEIGHTS.validate },
    approved ? { id: 'script', name: 'Approved script loading', weight: WEIGHTS.scriptLoad } : { id: 'script', name: 'Script generation (local LLM)', weight: WEIGHTS.scriptGenerate },
    { id: 'prepare', weight: WEIGHTS.prepare },
    { id: 'tts', weight: WEIGHTS.tts },
    { id: 'align', weight: WEIGHTS.align },
    { id: 'storyboard', weight: WEIGHTS.storyboard },
    { id: 'images', weight: WEIGHTS.images, skip: hybrid ? null : 'Procedural visual mode selected: no AI images needed' },
    { id: 'scene', weight: WEIGHTS.scene },
    { id: 'capture', weight: WEIGHTS.capture },
    { id: 'audio', weight: WEIGHTS.audio },
    { id: 'compose', weight: WEIGHTS.compose },
    { id: 'qa', weight: WEIGHTS.qa },
  ];
}
export const scriptPlan = () => [{ id: 'validate', weight: 1 }, { id: 'script', name: 'Script generation (local LLM)', weight: 20 }, { id: 'prepare', name: 'Language check & duration estimate', weight: 1 }];

export const inputFromConfig = (c) => ({ topic: c.topic, language: c.language.id, personality: c.narration.personality, voice: c.narration.voice, speed: c.narration.speed, style: c.visual.style, character: c.visual.character, ...(c.visual.look ? { look: c.visual.look } : {}), durationSeconds: c.durationSeconds, durationTolerance: c.durationTolerance, visualMode: c.visual.visualMode });

const node = process.execPath, PY = PATHS.python, SCRIPTS = PATHS.engineScripts;
const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const freeGB = () => { try { const s = fs.statfsSync(PATHS.root); return (s.bavail * s.bsize) / 1024 ** 3; } catch { return null; } }

async function ffprobe(job, stage, file) {
  let out = '';
  await run(job, stage, PATHS.ffprobe, ['-v', 'error', '-show_entries', 'stream=index,codec_name,codec_type,width,height,r_frame_rate,nb_frames,duration:format=duration,size', '-of', 'json', file], { quiet: true, onLine: (l) => { out += l; } });
  const j = JSON.parse(out), v = j.streams.find((s) => s.codec_type === 'video'), a = j.streams.find((s) => s.codec_type === 'audio');
  const [n, d] = (v?.r_frame_rate || '0/1').split('/').map(Number);
  return { width: v?.width, height: v?.height, fps: d ? n / d : 0, videoCodec: v?.codec_name, audioCodec: a?.codec_name || null, frames: v?.nb_frames ? +v.nb_frames : null, duration: +j.format.duration, size: +j.format.size };
}

// ── SCRIPT PREVIEW JOB ──────────────────────────────────────────────────────────────────────────────────────
export async function runScriptJob(job, { projectId, config, facts = null }) {
  job.startStage('validate', 'Checking the selected options against installed models');
  const v = validateGenerationConfig(inputFromConfig(config), { purpose: 'script' });
  if (!v.ok) throw new Error(v.errors.map((e) => e.message).join(' '));
  job.completeStage('validate', `${config.language.name} · ${config.narration.personalityName} · ${config.durationSeconds} s`);

  job.startStage('script', `Writing a ${config.language.name} script with the local model`);
  const ac = new AbortController(); const cancelPoll = setInterval(() => { if (job.cancelRequested) ac.abort(); }, 300);
  let res;
  try { res = await generateScript(config, { facts, signal: ac.signal, onProgress: (p) => job.stageProgress('script', p) }); }
  catch (e) { if (job.cancelRequested) throw Object.assign(new Error('Job cancelled by user'), { cancelled: true }); throw e; }
  finally { clearInterval(cancelPoll); }
  job.completeStage('script', `${res.meta.lineCount} lines, ${res.meta.wordCount} words (${res.meta.tokens} tokens, ${res.meta.attempts} attempt${res.meta.attempts > 1 ? 's' : ''})`);

  job.startStage('prepare', 'Verifying language and estimating narration length');
  const problems = checkLanguage(res.script, config);
  if (problems.length) throw new Error(problems.join('; '));
  const est = estimateSeconds(res.script, config);
  const saved = addScriptVersion(projectId, res.script, { factsProvided: !!facts, factFile: res.meta.factFile, claimReview: res.meta.claimReview, claimsApproved: res.meta.claimReview.summary.needsReview === 0, claimsToVerify: res.meta.claimsToVerify, ...(res.meta.polish ? { polish: res.meta.polish } : {}), ...(res.meta.viaEnglish ? { viaEnglish: true, englishDraft: res.meta.englishDraft } : {}), ...(res.meta.llmReview ? { llmReview: res.meta.llmReview } : {}), attempts: res.meta.attempts, source: 'llm', fingerprint: scriptFingerprint(config), configHash: configHash(config), model: res.meta.model, wordCount: est.words, estimatedSeconds: est.seconds, language: config.language.id, personality: config.narration.personality, targetSeconds: config.durationSeconds,
    // the validation results of THIS version (Script Studio shows exactly these for the version it previews)
    topic: config.topic, generatedAt: new Date().toISOString(), status: res.meta.status || null, gates: res.meta.gates || null, gateGroups: res.meta.gateGroups || null,
    claims: res.meta.claims || null, draftFlags: res.meta.draftFlags || null, editorialJudgment: res.meta.editorialJudgment || null,
    research: res.meta.research ? { essentials: res.meta.research.essentials, needsResearch: res.meta.research.needsResearch, rejected: res.meta.research.rejected } : null,
    plan: res.meta.plan || null, hookEndingRewrite: res.meta.hookEndingRewrite || null, visuals: res.meta.visuals || null, lengthFit: res.meta.lengthFit || null, generationLog: res.meta.generationLog || null });
  job.completeStage('prepare', `≈${est.seconds} s estimated for a ${config.durationSeconds} s target`);
  job.complete({ projectId, version: saved.version, script: res.script, estimate: est, meta: res.meta }, `Script v${saved.version} ready for review`);
}

// ── RENDER JOB ──────────────────────────────────────────────────────────────────────────────────────────────
export async function runRenderJob(job, { projectId, config, scriptVersion, acceptUnverifiedClaims = false }) {
  const dir = projectDir(projectId), cat = getCatalog(true), style = cat.styles.find((s) => s.id === config.visual.style);
  const env = childEnv({ FFMPEG: PATHS.ffmpeg, FPS: String(config.fps) });
  const rec = (fn) => updateProject(projectId, fn);
  rec((p) => { p.status = 'rendering'; p.history.push({ jobId: job.id, status: 'started', at: new Date().toISOString() }); });

  // 1 · validation ──────────────────────────────────────────────────────────────────────────────────────────
  job.startStage('validate', 'Re-validating the saved configuration against installed models');
  const v = validateGenerationConfig(inputFromConfig(config), { purpose: 'render', hasApprovedScript: !!scriptVersion });
  if (!v.ok) throw new Error(v.errors.map((e) => e.message).join(' '));
  if (configHash(v.config) !== configHash(config)) throw new Error('installed models or options changed since this configuration was saved; re-validate it');
  const gb = freeGB(); if (gb !== null && gb < 1.5) throw new Error(`only ${gb.toFixed(1)} GB free on the workspace drive; at least 1.5 GB is needed to render`);
  for (const w of v.warnings) job.warn(w);
  job.completeStage('validate', `project ${rel(dir)} · ${config.language.name} · ${config.narration.voice} · ${config.visual.styleName} · ${config.visual.characterName} · ${config.durationSeconds} s`);

  // 2 · script ──────────────────────────────────────────────────────────────────────────────────────────────
  let script, version = scriptVersion;
  if (scriptVersion) {
    job.startStage('script', `Loading approved script v${scriptVersion}`);
    const s = getScriptVersion(projectId, scriptVersion);
    if (!s) throw new Error(`approved script v${scriptVersion} not found`);
    if (s.meta.fingerprint !== scriptFingerprint(config)) throw new Error(`script v${scriptVersion} was written for a different topic/language/personality/duration; regenerate the preview`);
    const gate = claimsGate(s.meta);
    if (!gate.ok) throw new Error(gate.message);
    script = { title: s.title, lines: s.lines };
    job.completeStage('script', `approved v${scriptVersion}: ${script.lines.length} lines${s.meta.claimReview ? ` · facts: ${s.meta.claimReview.summary.supported} supported, ${(s.meta.confirmedClaims || []).length} confirmed by you` : ''}`);
  } else {
    job.startStage('script', `Writing a ${config.language.name} script with the local model`);
    const res = await generateScript(config, { onProgress: (p) => job.stageProgress('script', p) });
    script = res.script;
    // one-click render: no preview to review, so flagged claims need an explicit acceptance in the request; a known
    // factual error is never rendered
    const rv = res.meta.claimReview, contradicted = rv.claims.filter((c) => c.status === 'contradicted');
    const acceptance = rv.summary.needsReview && !contradicted.length && acceptUnverifiedClaims ? { claimsApproved: true, claimsApprovedAt: new Date().toISOString(), claimsApprovedBy: 'render request (acceptUnverifiedClaims)' } : { claimsApproved: rv.summary.needsReview === 0 };
    const saved = addScriptVersion(projectId, script, { claimReview: rv, factFile: res.meta.factFile, ...acceptance, ...(res.meta.llmReview ? { llmReview: res.meta.llmReview } : {}), source: 'llm-at-render', fingerprint: scriptFingerprint(config), configHash: configHash(config), model: res.meta.model, wordCount: res.meta.wordCount, estimatedSeconds: res.meta.estimatedSeconds, language: config.language.id, personality: config.narration.personality, targetSeconds: config.durationSeconds,
    // the validation results of THIS version (Script Studio shows exactly these for the version it previews)
    topic: config.topic, generatedAt: new Date().toISOString(), status: res.meta.status || null, gates: res.meta.gates || null, gateGroups: res.meta.gateGroups || null,
    claims: res.meta.claims || null, draftFlags: res.meta.draftFlags || null, editorialJudgment: res.meta.editorialJudgment || null,
    research: res.meta.research ? { essentials: res.meta.research.essentials, needsResearch: res.meta.research.needsResearch, rejected: res.meta.research.rejected } : null,
    plan: res.meta.plan || null, hookEndingRewrite: res.meta.hookEndingRewrite || null, visuals: res.meta.visuals || null, lengthFit: res.meta.lengthFit || null, generationLog: res.meta.generationLog || null });
    version = saved.version;
    if (contradicted.length) throw new Error(`Script v${version} repeats ${contradicted.length} known factual error(s): ${contradicted.map((c) => `line ${c.line}: ${c.note}`).join('; ')}. Edit it in Script Studio.`);
    if (res.meta.llmReview && !res.meta.llmReview.confirmed) throw new Error(`Script v${version}: the local model's proof-read still flags ${res.meta.llmReview.issues.length} line(s) (${res.meta.llmReview.issues.slice(0, 3).map((i) => `line ${i.line}: ${i.problem}`).join('; ')}). Open it in Script Studio, fix or approve those lines, then render.`);
    if (!acceptance.claimsApproved) throw new Error(`Script v${version} has ${rv.summary.needsReview} factual claim(s) to review. Open it in Script Studio, confirm the claims, then render.`);
    for (const c of rv.claims.filter((x) => x.status !== 'supported')) job.warn(`Unverified claim accepted by the render request: line ${c.line} ${c.kind} "${c.value}"`);
    approveScriptVersion(projectId, saved.version);
    job.completeStage('script', `generated v${version}: ${script.lines.length} lines, ${res.meta.wordCount} words`);
  }
  stopLLM();   // free the GPU for TTS/ComfyUI/WebGL

  // 3 · preparation ─────────────────────────────────────────────────────────────────────────────────────────
  job.startStage('prepare', 'Checking script language and writing narration files');
  const problems = checkLanguage(script, config);
  if (problems.length) throw new Error(`script does not match ${config.language.name}: ${problems.join('; ')}`);
  for (const d of ['audio', 'renders', 'review', 'scenes', 'storyboard', 'generated-images']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  writeRuntimeScript(dir, script, config);
  const est = estimateSeconds(script, config);
  job.completeStage('prepare', `${script.lines.length} lines, ${est.words} words, ≈${est.seconds} s estimated`);

  // 4 · TTS (+ duration control) ────────────────────────────────────────────────────────────────────────────
  const T = config.durationSeconds, tol = config.durationTolerance;
  const tts = async (speed, label) => {
    const r = await run(job, 'tts', PY, [path.join(SCRIPTS, 'voice.py'), '--script', path.join(dir, 'script.json'), '--out-dir', path.join(dir, 'audio'), '--voice', config.narration.voice, '--lang', config.narration.ttsLang, '--speed', String(speed)], { env });
    const res = r.results.find((x) => x.duration); if (!res) throw new Error('voice.py returned no result'); job.log(`  narration ${label}: ${res.duration.toFixed(2)} s at speed ${speed}`); return res;
  };
  job.startStage('tts', `Synthesizing ${config.language.name} narration with ${config.narration.voice} (${config.narration.ttsLang})`);
  let narr = await tts(config.narration.speed, 'pass 1'), speedUsed = config.narration.speed;
  // learn the real speaking rate from every first pass, including scripts that then fail the length check
  recordVoiceRate(config.narration.voice, script.lines.reduce((a, l) => a + countWords(l.say || l.text), 0), narr.speechSeconds, config.narration.speed);
  if (Math.abs(narr.duration - T) > tol * T) {
    // aim for the exact target, but clamp to the personality's speed range: landing anywhere inside ±tol is a pass
    const fixed = narr.duration - narr.speechSeconds, base = config.narration.delivery.speed;
    const lo = Math.max(0.8, base - 0.15), hi = Math.min(1.25, base + 0.18);
    const need = speedUsed * narr.speechSeconds / Math.max(1, T - fixed);
    const s2 = Math.round(Math.min(hi, Math.max(lo, need)) * 100) / 100;
    const predicted = fixed + narr.speechSeconds * speedUsed / s2;
    if (Math.abs(predicted - T) <= tol * T) {
      job.warn(`Narration was ${narr.duration.toFixed(1)} s for a ${T} s target; re-synthesizing at speed ${s2} (personality default ${base}) to fit ±${Math.round(tol * 100)}%`);
      job.stageProgress('tts', { indeterminate: true, message: `Re-synthesizing at speed ${s2} to fit ${T} s` });
      narr = await tts(s2, 'pass 2'); speedUsed = s2;
    }
    if (Math.abs(narr.duration - T) > tol * T) throw new Error(`the narration reads ${narr.duration.toFixed(1)} s at a natural pace, outside ${T} s ±${Math.round(tol * 100)}%. Shorten/lengthen the script (≈${Math.round(est.words * T / narr.duration)} words) or change the target duration.`);
  }
  rec((p) => { p.voice = { id: config.narration.voice, ttsLang: config.narration.ttsLang, speed: speedUsed, narrationSeconds: narr.duration, speechSeconds: narr.speechSeconds, model: 'Kokoro-82M v1.0 ONNX', synthSeconds: narr.synthSeconds }; });
  job.completeStage('tts', `${narr.duration.toFixed(2)} s narration (${narr.sentences} sentences, voice ${config.narration.voice}, speed ${speedUsed})`);

  // 5 · alignment ───────────────────────────────────────────────────────────────────────────────────────────
  const wm = whisperFor(config.language.code, cat._internal.whisper);
  job.startStage('align', `Aligning words with ${wm.name}`);
  const al = (await run(job, 'align', PY, [path.join(SCRIPTS, 'words.py'), '--project', dir, '--model', wm.dir, '--language', config.language.code], { env })).results.find((x) => x.words) || {};
  if (wm.multilingual && al.detectedLanguage && al.detectedLanguage !== config.language.code) throw new Error(`Whisper identifies the synthesized narration as "${al.detectedLanguage}" (${Math.round((al.languageProbability || 0) * 100)}%), not ${config.language.code}`);
  rec((p) => { p.alignment = { model: wm.name, words: al.words, matchRate: al.matchRate, detectedLanguage: al.detectedLanguage, languageProbability: al.languageProbability, languageCheck: al.languageCheck, transcriptSample: (al.transcript || '').slice(0, 300) }; });
  job.completeStage('align', `${al.words} words aligned, ${Math.round((al.matchRate || 0) * 100)}% matched${al.detectedLanguage ? `, spoken language: ${al.detectedLanguage} (${Math.round((al.languageProbability || 0) * 100)}%)` : ''}`);

  // 6 · storyboard ──────────────────────────────────────────────────────────────────────────────────────────
  job.startStage('storyboard', 'Planning shots from the narration');
  const timing = readJSON(path.join(dir, 'audio', 'lines.json')), words = readJSON(path.join(dir, 'audio', 'words.json'));
  const sb = planStoryboard({ script, timing, words, config, style, topic: config.topic });
  const sbVersion = (loadProject(projectId).storyboard?.version || 0) + 1;
  sb.version = sbVersion; sb.scriptVersion = version;
  const writeSB = () => { fs.writeFileSync(path.join(dir, 'storyboard', `v${String(sbVersion).padStart(3, '0')}.json`), JSON.stringify(sb, null, 2)); fs.writeFileSync(path.join(dir, 'storyboard', 'storyboard.json'), JSON.stringify(sb, null, 2)); };
  writeSB();
  const methods = sb.shots.reduce((m, s) => ((m[s.method] = (m[s.method] || 0) + 1), m), {});
  rec((p) => { p.storyboard = { version: sbVersion, shots: sb.shots.length, planner: sb.planner, methods, environments: [...new Set(sb.shots.map((s) => s.environment))] }; });
  job.completeStage('storyboard', `${sb.shots.length} shots · ${Object.entries(methods).map(([k, n]) => `${n} ${k}`).join(', ')}`);

  // 7 · images ──────────────────────────────────────────────────────────────────────────────────────────────
  const imageShots = sb.shots.filter((s) => s.imagePrompt && !s.imageReuse);
  if (config.visual.visualMode === 'hybrid-local' && imageShots.length) {
    const reused = sb.shots.filter((s) => s.imageReuse).length;
    job.startStage('images', `Generating ${imageShots.length} images locally with ComfyUI${reused ? ` (${reused} shots reuse one of them)` : ''}`);
    const idx = readImageIndex(dir), inventory = [];
    for (const [k, sh] of imageShots.entries()) {
      job.throwIfCancelled();
      const prev = idx.shots[sh.id], file = path.join(dir, 'generated-images', `${sh.id}.png`);
      let seed = prev && prev.prompt === sh.imagePrompt && !prev.rejected ? prev.seed : seedFor(sh.imagePrompt, 0), meta, problem = null, attempts = [];
      // exposure gate: a near-black, blown-out or flat image is regenerated locally with a new seed (and, for a
      // too-dark result, a lighting hint) — up to 3 attempts; the best attempt is kept and reported if none passes
      for (let attempt = 0; attempt < 3; attempt++) {
        const positive = attempt && /near-black/.test(problem || '') ? sh.imagePrompt + ', clearly visible subject, dramatic rim light, readable details' : sh.imagePrompt;
        job.stageProgress('images', { current: k, total: imageShots.length, message: `Generating image ${k + 1} of ${imageShots.length} (${sh.id})${attempt ? ` · retry ${attempt}` : ''}` });
        meta = await generateImage({ positive, negative: sh.negativePrompt, seed, outFile: file, prefix: `studio/${projectId}/${sh.id}`, isCancelled: () => job.cancelRequested,
          onStep: ({ current, total }) => job.stageProgress('images', { fraction: (k + current / total) / imageShots.length, message: `Generating image ${k + 1} of ${imageShots.length}: step ${current}/${total}` }) });
        const st = imageStats(file); problem = judgeImage(st); attempts.push({ seed, ...st, problem });
        if (!problem) break;
        job.log(`  ${sh.id}: image rejected (${problem}), regenerating`);
        seed = seedFor(sh.imagePrompt, attempt + 1);
      }
      if (problem) {
        const best = attempts.reduce((x, y) => (Math.min(y.high, 255 - y.low) > Math.min(x.high, 255 - x.low) ? y : x));
        if (best.seed !== seed) meta = await generateImage({ positive: sh.imagePrompt, negative: sh.negativePrompt, seed: best.seed, outFile: file, prefix: `studio/${projectId}/${sh.id}`, isCancelled: () => job.cancelRequested });
        seed = best.seed;
        if (autoLevel(file)) { const st = imageStats(file), p2 = judgeImage(st); attempts.push({ seed, ...st, problem: p2, autoLevel: true }); job.log(`  ${sh.id}: auto-levelled locally → ${p2 || 'ok'} (luma ${Math.round(st.avg)}/${st.low}–${st.high})`); problem = p2; }
        if (problem) job.warn(`Image ${sh.id} still ${problem} after 3 attempts; shot QA will judge the rendered frame`);
      }
      sh.image = `generated-images/${sh.id}.png`;
      idx.shots[sh.id] = { file: sh.image, prompt: sh.imagePrompt, negative: sh.negativePrompt, seed, key: meta.key, cached: meta.cached, seconds: meta.seconds, exposure: attempts.at(-1), attempts: attempts.length, rejected: !!problem, approved: prev?.approved && prev.prompt === sh.imagePrompt ? true : false, createdAt: new Date().toISOString() };
      inventory.push({ shot: sh.id, ...idx.shots[sh.id] });
      job.log(`  ${sh.id}: ${meta.cached ? 'reused cached image' : `generated in ${meta.seconds} s`} (seed ${seed}, luma ${attempts.at(-1).avg}/${attempts.at(-1).low}–${attempts.at(-1).high})`);
    }
    for (const sh of sb.shots) if (sh.imageReuse) { sh.image = sb.shots.find((x) => x.id === sh.imageReuse).image; job.log(`  ${sh.id}: reuses ${sh.imageReuse}'s image`); }
    writeImageIndex(dir, idx); writeSB(); await freeVram();
    rec((p) => { p.assets.images = inventory.map(({ shot, file, seed, cached, seconds, attempts, rejected }) => ({ shot, file, seed, cached, seconds, attempts, rejected })); p.assets.imageReuse = sb.shots.filter((s) => s.imageReuse).map((s) => ({ shot: s.id, from: s.imageReuse })); p.models.imageGeneration = { engine: 'ComfyUI', checkpoint: cat._internal.comfy.checkpoint, license: cat._internal.comfy.license }; });
    job.completeStage('images', `${imageShots.length} images (${inventory.filter((i) => i.cached).length} from cache, ${inventory.filter((i) => i.attempts > 1).length} regenerated)`);
  } else if (job.stage('images').status !== 'skipped') job.skipStage('images', 'no shots need AI images');

  // 8 · scene construction ─────────────────────────────────────────────────────────────────────────────────
  job.startStage('scene', `Building ${style.name} scenes`);
  const { inventory, fonts } = scaffoldRuntime(dir, config);
  const character = characterSpec(config, cat.characters.find((c) => c.id === config.visual.character));
  writeScene(dir, { config, style, character, storyboard: sb, fonts });
  const chk = await run(job, 'scene', node, ['tools/capture.mjs', 'check'], { cwd: dir, env });
  const check = chk.results.find((x) => 'ok' in x) || {};
  fs.writeFileSync(path.join(dir, 'scenes', 'check.txt'), chk.tail.join('\n'));
  rec((p) => { p.assets.runtime = inventory; p.assets.character = character; p.assets.environments = [...new Set(sb.shots.map((s) => s.environment))]; p.assets.props = [...new Set(sb.shots.flatMap((s) => s.objects))]; p.render = { ...(p.render || {}), webgl: check.gpu }; });
  job.completeStage('scene', `${check.shots} shots, ${check.captions} captions, no errors · WebGL: ${check.gpu}`);

  // 9 · frame capture ───────────────────────────────────────────────────────────────────────────────────────
  job.startStage('capture', `Capturing ${Math.round(timing.duration * config.fps)} frames at ${config.fps} fps`);
  const cap = (await run(job, 'capture', node, ['tools/capture.mjs', 'video', 'renders/video-only.mp4'], { cwd: dir, env })).results.find((x) => x.frames) || {};
  job.completeStage('capture', `${cap.frames} frames in ${cap.seconds} s`);

  // 10 · audio ──────────────────────────────────────────────────────────────────────────────────────────────
  job.startStage('audio', 'Extracting sound cues and mixing narration, music and effects');
  await run(job, 'audio', node, ['tools/capture.mjs', 'cues'], { cwd: dir, env });
  const mix = (await run(job, 'audio', PY, ['tools/mix.py', '.'], { cwd: dir, env })).results.find((x) => x.duration) || {};
  job.completeStage('audio', `music "${mix.music}", ${mix.cues} effects`);

  // 11 · composition ────────────────────────────────────────────────────────────────────────────────────────
  const outName = `${projectId}.mp4`, final = path.join(dir, 'renders', outName);
  job.startStage('compose', 'Muxing video and audio with FFmpeg');
  await run(job, 'compose', PATHS.ffmpeg, ['-v', 'error', '-y', '-i', path.join(dir, 'renders', 'video-only.mp4'), '-i', path.join(dir, 'audio', 'mix.wav'), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', final], {
    env, quiet: true, onLine: (l) => { const m = l.match(/^out_time_us=(\d+)/); if (m) job.stageProgress('compose', { fraction: Math.min(1, +m[1] / 1e6 / timing.duration), message: `Muxing: ${(+m[1] / 1e6).toFixed(1)} s of ${timing.duration.toFixed(1)} s` }); },
  });
  job.completeStage('compose', rel(final));

  // 12 · QA + export ────────────────────────────────────────────────────────────────────────────────────────
  job.startStage('qa', 'Verifying the MP4 with FFprobe');
  const info = await ffprobe(job, 'qa', final);
  job.stageProgress('qa', { current: 1, total: 6, message: 'Detecting frozen and black frames' });
  let fz = '', bl = '';
  await run(job, 'qa', PATHS.ffmpeg, ['-hide_banner', '-i', final, '-vf', 'freezedetect=n=-55dB:d=2.6,blackdetect=d=0.4:pix_th=0.06', '-map', '0:v:0', '-f', 'null', '-'], { env, quiet: true, onLine: (l) => { if (/freeze_(start|end|duration)/.test(l)) fz += l + '\n'; if (/black_start/.test(l)) bl += l + '\n'; } });
  let vol = '';
  job.stageProgress('qa', { current: 2, total: 6, message: 'Measuring audio level' });
  await run(job, 'qa', PATHS.ffmpeg, ['-hide_banner', '-i', final, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { env, quiet: true, onLine: (l) => { if (/mean_volume/.test(l)) vol = l; } });
  const meanDb = parseFloat((vol.match(/mean_volume:\s*(-?[\d.]+)/) || [])[1]);
  // visible content: per-frame mean luma at 2 fps. Grainy near-black frames defeat blackdetect, so measure brightness
  // directly (calibrated: a night video where nothing is visible had 71% of frames < 25 and mean 27.5; a space video
  // with visible subjects had 24% and mean 64.5).
  // 4 fps luma (mean + 10th/90th percentile) → whole-video visibility and per-shot exposure verdicts
  const frames = []; let fcur = null;
  await run(job, 'qa', PATHS.ffmpeg, ['-hide_banner', '-i', final, '-vf', 'fps=4,signalstats,metadata=print:file=-', '-an', '-f', 'null', '-'], { env, quiet: true, onLine: (l) => {
    let m = l.match(/pts_time:([\d.]+)/); if (m) { fcur = { t: +m[1] }; frames.push(fcur); return; }
    m = l.match(/signalstats\.(YAVG|YLOW|YHIGH)=([\d.]+)/); if (m && fcur) fcur[{ YAVG: 'avg', YLOW: 'low', YHIGH: 'high' }[m[1]]] = +m[2];
  } });
  const yav = frames.map((f) => f.avg).filter(Number.isFinite);
  const shotQA = judgeShots(frames, sb.shots);
  fs.writeFileSync(path.join(dir, 'review', 'shot_exposure.json'), JSON.stringify(shotQA, null, 2));
  for (const b of shotQA.bad) job.log(`  QA: shot ${b.id} (${b.start.toFixed(1)}–${b.end.toFixed(1)} s) ${b.problem}`);
  const darkShare = yav.length ? yav.filter((y) => y < 25).length / yav.length : 1, meanLuma = yav.length ? yav.reduce((a, b) => a + b, 0) / yav.length : 0;
  const freezes = [...fz.matchAll(/freeze_duration:\s*([\d.]+)/g)].map((m) => +m[1]);
  const blacks = [...bl.matchAll(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/g)].map((m) => [+m[1], +m[2]]).filter(([s, e]) => s > 0.6 && e < timing.duration - 0.6);
  const checks = {
    mp4_readable: !!info.videoCodec, resolution_1080x1920: info.width === config.width && info.height === config.height, fps_matches: Math.abs(info.fps - config.fps) < 0.05,
    video_h264: info.videoCodec === 'h264', audio_aac: info.audioCodec === 'aac', audio_not_silent: Number.isFinite(meanDb) && meanDb > -45,
    duration_within_tolerance: Math.abs(info.duration - T) <= tol * T, video_matches_narration: Math.abs(info.duration - timing.duration) < 0.25,
    no_long_freezes: freezes.every((d) => d < 4), no_black_gaps: blacks.length === 0,
    visible_content: darkShare <= 0.45 && meanLuma >= 32,
    shot_exposure: shotQA.bad.length === 0,
  };
  if (!checks.visible_content) job.log(`  QA: video too dark to see: ${Math.round(darkShare * 100)}% of frames below luma 25, mean luma ${meanLuma.toFixed(1)}`);
  const mandatory = ['mp4_readable', 'resolution_1080x1920', 'fps_matches', 'video_h264', 'audio_aac', 'audio_not_silent', 'duration_within_tolerance', 'video_matches_narration', 'visible_content', 'shot_exposure'];
  const failed = mandatory.filter((k) => !checks[k]);
  for (const k of ['no_long_freezes', 'no_black_gaps']) if (!checks[k]) job.warn(`QA: ${k.replace(/_/g, ' ')} failed (${k === 'no_long_freezes' ? freezes.map((d) => d.toFixed(1) + ' s').join(', ') : blacks.map(([s, e]) => `${s.toFixed(1)}–${e.toFixed(1)} s`).join(', ')})`);
  job.stageProgress('qa', { current: 3, total: 6, message: 'Rendering cover and contact sheet' });
  const coverT = sb.shots[Math.min(1, sb.shots.length - 1)].start + 0.9;
  await run(job, 'qa', node, ['tools/capture.mjs', 'frames', 'review/frames', String(coverT.toFixed(2))], { cwd: dir, env, quiet: true });
  const fr = fs.readdirSync(path.join(dir, 'review', 'frames')).find((f) => f.endsWith('.jpg')); if (fr) fs.copyFileSync(path.join(dir, 'review', 'frames', fr), path.join(dir, 'review', 'cover.jpg'));
  await run(job, 'qa', node, ['tools/capture.mjs', 'sheet', 'review/sheet.jpg', '1', '8'], { cwd: dir, env, quiet: true });
  const report = { project: projectId, video: rel(final), status: failed.length ? 'FAIL' : Object.values(checks).every(Boolean) ? 'PASS' : 'PASS_WITH_WARNINGS', metrics: { ...info, meanVolumeDb: meanDb, meanLuma: +meanLuma.toFixed(1), darkFrameShare: +darkShare.toFixed(3), freezes, blackGaps: blacks, badShots: shotQA.bad, targetSeconds: T, tolerance: tol, narrationSeconds: timing.duration }, checks, failed, checkedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, 'review', 'qa_report.json'), JSON.stringify(report, null, 2));
  if (failed.length) { rec((p) => { p.qa = report; p.status = 'failed'; }); throw new Error(`QA failed: ${failed.join(', ')}`); }
  job.stageProgress('qa', { current: 5, total: 6, message: 'Exporting to the workspace exports folder' });
  fs.mkdirSync(PATHS.exports, { recursive: true });
  const exp = path.join(PATHS.exports, outName);
  fs.copyFileSync(final, exp);
  const expInfo = await ffprobe(job, 'qa', exp);
  if (expInfo.size !== info.size || Math.abs(expInfo.duration - info.duration) > 0.01) throw new Error('export copy does not match the rendered file');
  const result = { projectId, exportPath: rel(exp), exportAbsolutePath: exp, renderPath: rel(final), durationSeconds: +info.duration.toFixed(2), targetSeconds: T, withinTolerance: checks.duration_within_tolerance, width: info.width, height: info.height, fps: info.fps, sizeMB: +(info.size / 1048576).toFixed(2), qa: report.status, videoUrl: `/media/exports/${outName}` };
  rec((p) => {
    p.status = 'rendered'; p.exportPath = result.exportPath; p.qa = { status: report.status, checks, failed, report: rel(path.join(dir, 'review', 'qa_report.json')) };
    p.render = { ...(p.render || {}), jobId: job.id, finishedAt: new Date().toISOString(), durationSeconds: result.durationSeconds, targetSeconds: T, withinTolerance: result.withinTolerance, frames: cap.frames, captureSeconds: cap.seconds, file: result.renderPath, exportPath: result.exportPath, scriptVersion: version, storyboardVersion: sbVersion };
    p.models.tts = { engine: 'Kokoro-82M v1.0 ONNX', voice: config.narration.voice, lang: config.narration.ttsLang };
    p.models.alignment = { engine: 'faster-whisper', model: wm.name };
    p.history.push({ jobId: job.id, status: 'completed', at: new Date().toISOString() });
  });
  job.completeStage('qa', `${report.status} · exported ${rel(exp)}`);
  job.complete(result, `Video ready: ${rel(exp)} (${result.durationSeconds} s)`);
}

export const CHROME_PATH = CHROME;
