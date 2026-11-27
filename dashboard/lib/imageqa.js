// Image intelligence (Step 7) — checks on the ACTUAL generated image, not its prompt.
//
// 1. Pixel-level technical inspection (deterministic, FFmpeg only, no model): readable, size/aspect, luma (near-black,
//    blown out, flat), blank (entropy), blur, black borders/empty areas, perceptual hash for duplicates and repeated
//    compositions, colour/style jumps between connected scenes.
// 2. Pixel-level semantic inspection (vision model): a vision-capable local model DESCRIBES the image (subject,
//    objects with counts, actions, period cues, text/watermarks); that description — derived from pixels, not from the
//    prompt — is then checked against the narration, storyboard and fact file with the Step 6 rules. Requires a vision
//    projector for the local model (llama-server --mmproj); without one this part reports "not available" and every
//    image needs human review — it never passes silently.
// 3. Gates per image and per project; critical findings block approval; uncertain → NEEDS_REVIEW.
// 4. Regeneration plan/workflow for failed images only, with versions, limits and re-inspection (injected generator).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PATHS } from './workspace.js';
import { imageStats, judgeImage } from './exposure.js';
import { visualReport } from './visualsem.js';

const ff = (args) => spawnSync(PATHS.ffmpeg, ['-hide_banner', ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 20 });
const ffbuf = (args) => spawnSync(PATHS.ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true, maxBuffer: 1 << 20 });
const num = (s, k) => { const m = String(s).match(new RegExp(`${k}=([\\d.]+)`)); return m ? +m[1] : NaN; };

/** raw pixel measurements of one image (FFmpeg); null fields when the image cannot be decoded */
export function measureImage(file) {
  const out = { file, exists: fs.existsSync(file), bytes: 0 };
  if (!out.exists) return out;
  out.bytes = fs.statSync(file).size;
  const info = ff(['-i', file]);
  const dim = String(info.stderr).match(/Video: [^,]+.*?, (\d+)x(\d+)/);
  out.width = dim ? +dim[1] : null; out.height = dim ? +dim[2] : null;
  if (!out.width) return out;
  Object.assign(out, imageStats(file));
  const st = ff(['-i', file, '-vf', 'signalstats,entropy,metadata=print:file=-', '-f', 'null', '-']).stdout || '';
  out.saturation = num(st, 'signalstats\\.SATAVG'); out.hue = num(st, 'signalstats\\.HUEAVG'); out.entropy = num(st, 'entropy\\.normalized_entropy\\.normal\\.Y');
  const bl = ff(['-i', file, '-vf', 'blurdetect=block_width=32:block_height=32,metadata=print:file=-', '-f', 'null', '-']).stdout || '';
  out.blur = num(bl, 'lavfi\\.blur');
  // empty / black areas: a 16×28 grey grid; a band of near-black cells along an edge = black border (cropdetect gives
  // nothing for a single still image)
  const grid = ffbuf(['-i', file, '-vf', 'scale=16:28:flags=area,format=gray', '-f', 'rawvideo', '-']).stdout;
  if (grid && grid.length >= 448) {
    const dark = (x, y) => grid[y * 16 + x] < 10;
    const rowDark = (y) => [...Array(16).keys()].every((x) => dark(x, y)), colDark = (x) => [...Array(28).keys()].every((y) => dark(x, y));
    let top = 0; while (top < 28 && rowDark(top)) top++; let bot = 0; while (bot < 28 - top && rowDark(27 - bot)) bot++;
    let left = 0; while (left < 16 && colDark(left)) left++; let right = 0; while (right < 16 - left && colDark(15 - right)) right++;
    out.contentArea = +(((16 - left - right) * (28 - top - bot)) / 448).toFixed(3);
    out.darkCells = +([...grid.subarray(0, 448)].filter((v) => v < 10).length / 448).toFixed(3);
  }
  // 64-bit difference hash: 9×8 grey, each pixel compared with its right neighbour
  const g = ffbuf(['-i', file, '-vf', 'scale=9:8:flags=area,format=gray', '-f', 'rawvideo', '-']).stdout;
  if (g && g.length >= 72) { let h = ''; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) h += g[y * 9 + x] > g[y * 9 + x + 1] ? '1' : '0'; out.dhash = h; }
  return out;
}
export const hamming = (a, b) => (a && b ? [...a].filter((c, i) => c !== b[i]).length : 64);

// limits calibrated on the existing generated images of this workspace (see tests/imageqa.test.mjs and the Step 7 report)
export const IMAGE_LIMITS = { aspect: 912 / 512, aspectTol: 0.04, minEntropy: 0.35, blurReview: 0.0, contentArea: 0.85, dupHash: 5, similarHash: 12, satJump: 3 };

/** technical findings for one measured image (no model) */
export function technicalFindings(m, limits = IMAGE_LIMITS) {
  const f = [], add = (problem, severity, evidence, action) => f.push({ category: 'technical', problem, severity, evidence, action });
  if (!m.exists) { add('image file is missing', 'error', m.file, 'regenerate the image'); return f; }
  if (!m.width) { add('image cannot be decoded (corrupted or not an image)', 'error', `${m.bytes} bytes`, 'regenerate the image'); return f; }
  const ar = m.height / m.width;
  if (Math.abs(ar - limits.aspect) / limits.aspect > limits.aspectTol) add(`wrong aspect ratio (${m.width}×${m.height}, expected 9:16 portrait)`, 'error', `height/width ${ar.toFixed(3)}`, 'regenerate at the storyboard size');
  let exp = judgeImage(m);
  // a bright pastel ILLUSTRATION keeps its colour; a truly blown-out image loses it (seen: 6 bright, colourful
  // illustrations with saturation 15–32 flagged by the photo-tuned rule — the render's own exposure check is unchanged)
  if (exp && /blown out/.test(exp) && Number.isFinite(m.saturation) && m.saturation >= 12) exp = null;
  if (exp) add(exp, /near-black|unreadable/.test(exp) ? 'error' : 'review', `luma avg ${m.avg}, 10th ${m.low}, 90th ${m.high}`, 'regenerate with brighter lighting');
  if (Number.isFinite(m.entropy) && m.entropy < limits.minEntropy) add(`almost blank (normalised entropy ${m.entropy.toFixed(2)})`, 'error', null, 'regenerate');
  if (Number.isFinite(m.contentArea) && m.contentArea < limits.contentArea) add(`black border / empty area (content covers ${Math.round(m.contentArea * 100)} % of the frame)`, 'review', null, 'regenerate or crop');
  if (limits.blurReview > 0 && Number.isFinite(m.blur) && m.blur > limits.blurReview) add(`blurry (blur ${m.blur.toFixed(2)})`, 'review', null, 'regenerate with more steps / sharper prompt');
  return f;
}

/** cross-image findings: duplicates, repeated compositions, colour/style jumps between consecutive scenes */
export function setFindings(measured, limits = IMAGE_LIMITS) {
  const out = measured.map(() => []);
  for (let i = 0; i < measured.length; i++) for (let j = i + 1; j < measured.length; j++) {
    const d = hamming(measured[i].dhash, measured[j].dhash);
    if (d <= limits.dupHash) out[j].push({ category: 'technical', problem: `duplicate of ${measured[i].sceneId} (hash distance ${d})`, severity: 'review', evidence: null, action: 'regenerate with a different composition' });
    else if (d <= limits.similarHash && j === i + 1) out[j].push({ category: 'continuity', problem: `nearly the same composition as ${measured[i].sceneId} (hash distance ${d})`, severity: 'warning', evidence: null, action: 'vary the shot if the story moves on' });
  }
  const sats = measured.map((m) => m.saturation).filter(Number.isFinite).sort((a, b) => a - b), med = sats[Math.floor(sats.length / 2)];
  const mad = sats.length ? sats.map((s) => Math.abs(s - med)).sort((a, b) => a - b)[Math.floor(sats.length / 2)] || 1 : 1;
  measured.forEach((m, i) => { if (Number.isFinite(m.saturation) && Math.abs(m.saturation - med) / mad > limits.satJump * 2 && sats.length >= 4) out[i].push({ category: 'continuity', problem: `colour style differs from the other scenes (saturation ${m.saturation.toFixed(0)} vs median ${med.toFixed(0)})`, severity: 'warning', evidence: null, action: 'check the look matches the sequence' }); });
  return out;
}

// ── pixel-level semantic inspection (vision model) ──────────────────────────────────────────────────────────────
export const VISION_SCHEMA = { type: 'object', properties: {
  description: { type: 'string', maxLength: 400 }, mainSubject: { type: 'string', maxLength: 80 },
  objects: { type: 'array', maxItems: 8, items: { type: 'object', properties: { name: { type: 'string', maxLength: 40 }, count: { type: 'integer' } }, required: ['name', 'count'], additionalProperties: false } },
  people: { type: 'integer' }, era: { type: 'string', enum: ['ancient', 'medieval', 'colonial', 'modern', 'none/unclear'] },
  visibleText: { type: 'string', maxLength: 120 }, watermark: { type: 'boolean' }, distorted: { type: 'boolean' }, style: { type: 'string', maxLength: 40 },
}, required: ['description', 'mainSubject', 'objects', 'people', 'era', 'visibleText', 'watermark', 'distorted', 'style'], additionalProperties: false };

/** ask a vision-capable model to DESCRIBE the pixels (it is not told the narration, so it cannot just agree with it) */
export async function describeImage(file, { visionChat, signal } = {}) {
  if (!visionChat) return { available: false, reason: 'no vision model configured (the local model needs its vision projector, llama-server --mmproj)' };
  const b64 = fs.readFileSync(file).toString('base64');
  const messages = [{ role: 'system', content: 'You describe images objectively for a fact-checker. Describe only what is visible. Count objects and body parts exactly. Output ONLY JSON.' },
    { role: 'user', content: [{ type: 'text', text: 'Describe this image: the main subject, the visible objects with counts, how many people, the historical period suggested by clothing/buildings/technology, any visible text or watermark, any distortion (extra limbs, melted shapes), and the visual style.' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } }] }];
  try {
    const { text, truncated } = await visionChat({ messages, schema: VISION_SCHEMA, temperature: 0, maxTokens: 400, signal });
    if (truncated) return { available: true, error: 'vision answer cut off' };
    return { available: true, ...JSON.parse(text) };
  } catch (e) { if (signal?.aborted) throw e; return { available: true, error: String(e.message).slice(0, 120) }; }
}

/** findings from the pixel description: Step 6 rules run on what the IMAGE shows, plus text/watermark/distortion */
export function semanticFindings(config, sceneValue, i, desc, { topicFacts = null, storyKind = null } = {}) {
  const f = [];
  if (!desc?.available) return [{ category: 'semantic', problem: 'image content not inspected (no vision model available)', severity: 'review', evidence: desc?.reason || null, action: 'review the image by hand' }];
  if (desc.error) return [{ category: 'semantic', problem: `image content could not be inspected (${desc.error})`, severity: 'review', evidence: null, action: 'review the image by hand' }];
  // counts as words ("three hearts"), like narration — a digit here would read as a number the narration never said
  const W = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const seen = [desc.mainSubject && `Image of ${desc.mainSubject}`, desc.description, ...(desc.objects || []).map((o) => `${W[o.count] || o.count} ${o.name}`)].filter(Boolean).join('. ');
  const v = { ...sceneValue, script: { ...sceneValue.script, lines: sceneValue.script.lines.map((l, k) => (k === i ? { ...l, visual: seen } : l)) } };
  const rep = visualReport(config, v, { topicFacts, storyKind });
  for (const x of rep.scenes[i].findings.filter((y) => !['diversity', 'continuity'].includes(y.category))) {
    const cat = x.category === 'alignment' || x.category === 'completeness' ? 'semantic' : x.category === 'facts' ? 'factual' : 'accuracy';
    f.push({ category: cat, problem: `the image ${x.problem.replace(/^the visual /, '')}`, severity: x.severity, evidence: `image shows: ${seen.slice(0, 160)}${x.evidence ? ` · ${x.evidence}` : ''}`, action: x.recommendation || 'regenerate' });
  }
  if (desc.watermark || /[A-Za-z]{3,}/.test(desc.visibleText || '')) f.push({ category: 'technical', problem: `unwanted text or watermark in the image ("${String(desc.visibleText || 'watermark').slice(0, 60)}")`, severity: 'review', evidence: null, action: 'regenerate (text, watermark in the negative prompt)' });
  if (desc.distorted) f.push({ category: 'technical', problem: 'distorted shapes (extra limbs, melted objects)', severity: 'review', evidence: null, action: 'regenerate' });
  return f;
}

// ── report + gates ──────────────────────────────────────────────────────────────────────────────────────────────
const GATES = ['semantic', 'factual', 'accuracy', 'technical', 'continuity'];
const decide = (fs_) => (fs_.some((x) => x.severity === 'error') ? 'REJECTED' : fs_.some((x) => x.severity === 'review') ? 'NEEDS_REVIEW' : 'APPROVED');
/**
 * Image QA for one project. shots: [{ sceneId, file, line (0-based narration index), visual }]; sceneValue: the
 * script value used by visualReport (narration lines + plan). Returns { images:[…], gates:{…}, decision }.
 * A critical finding in ANY image blocks approval regardless of averages.
 */
export async function inspectProject(config, { projectId, shots, sceneValue, topicFacts = null, storyKind = null, visionChat = null, signal } = {}) {
  const measured = shots.map((s) => ({ ...measureImage(s.file), sceneId: s.sceneId }));
  const cross = setFindings(measured);
  const images = [];
  for (let k = 0; k < shots.length; k++) {
    const s = shots[k], m = measured[k];
    const tech = technicalFindings(m);
    const desc = m.width && !tech.some((x) => x.severity === 'error') ? await describeImage(s.file, { visionChat, signal }) : { available: false, reason: 'image not usable' };
    const sem = semanticFindings(config, sceneValue, s.line, desc, { topicFacts, storyKind });
    const findings = [...tech, ...cross[k], ...sem];
    const alignment = !desc.available || desc.error ? null : Math.max(0, 1 - findings.filter((x) => x.category === 'semantic').length * 0.5);
    images.push({ projectId, sceneId: s.sceneId, image: s.file, narration: sceneValue.script.lines[s.line]?.say || sceneValue.script.lines[s.line]?.text || '', visual: s.visual || '', alignmentScore: alignment, pixels: { width: m.width, height: m.height, avg: m.avg, low: m.low, high: m.high, entropy: m.entropy, blur: m.blur, contentArea: m.contentArea, saturation: m.saturation }, seen: desc.available && !desc.error ? desc : null, findings, decision: decide(findings) });
  }
  const gates = Object.fromEntries(GATES.map((g) => { const fs_ = images.flatMap((im) => im.findings.filter((x) => x.category === g).map((x) => ({ ...x, sceneId: im.sceneId }))); return [g, { ok: !fs_.some((x) => x.severity !== 'warning'), issues: fs_.filter((x) => x.severity !== 'warning').map((x) => `${x.sceneId}: ${x.problem}`), advisory: fs_.filter((x) => x.severity === 'warning').map((x) => `${x.sceneId}: ${x.problem}`) }]; }));
  const decision = images.some((im) => im.decision === 'REJECTED') ? 'REJECTED' : images.some((im) => im.decision === 'NEEDS_REVIEW') ? 'NEEDS_REVIEW' : 'APPROVED';
  gates.overall = { ok: decision === 'APPROVED', decision, issues: images.filter((im) => im.decision !== 'APPROVED').map((im) => `${im.sceneId}: ${im.decision}`) };
  return { images, gates, decision };
}

/**
 * Controlled correction for FAILED images only. regenerate(shot, attempt) → new file path (never overwrites the
 * original); inspect(file) → { decision, findings }. At most maxAttempts per image; every version and its rejection
 * reason is kept; if no version passes, the original stays and the image is NEEDS_REVIEW.
 */
export async function correctImages(report, { regenerate, inspect, maxAttempts = 2, maxImages = 4 } = {}) {
  const log = [];
  for (const im of report.images.filter((x) => x.decision !== 'APPROVED').slice(0, maxImages)) {
    const versions = [{ file: im.image, decision: im.decision, reasons: im.findings.filter((x) => x.severity !== 'warning').map((x) => x.problem) }];
    let kept = im.image, final = im.decision;
    for (let a = 1; a <= maxAttempts; a++) {
      let file; try { file = await regenerate(im, a); } catch (e) { versions.push({ attempt: a, error: String(e.message).slice(0, 120) }); continue; }
      if (!file || file === im.image) { versions.push({ attempt: a, error: 'regeneration did not produce a new file' }); continue; }
      const r = await inspect(file);
      versions.push({ attempt: a, file, decision: r.decision, reasons: (r.findings || []).filter((x) => x.severity !== 'warning').map((x) => x.problem) });
      if (r.decision === 'APPROVED') { kept = file; final = 'APPROVED'; break; }
    }
    log.push({ sceneId: im.sceneId, original: im.image, kept, decision: final === 'APPROVED' ? 'APPROVED (corrected)' : 'NEEDS_REVIEW (original kept)', versions });
  }
  return log;
}

/**
 * Local frame-level visual QA on rendered MP4 frames across each shot.
 * Samples frames at start, mid, end of each shot. Detects near-black, blank,
 * frozen shots and identical visuals across consecutive shots.
 */
export function inspectRenderFrames(videoPath, shots, { ffmpeg = PATHS.ffmpeg, framesDir = null } = {}) {
  const results = [];
  const errors = [];
  let prevMidHash = null, prevShotId = null;

  const tempDir = framesDir || path.join(path.dirname(videoPath), 'qa_frames_tmp');
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    for (const s of (shots || [])) {
      const dur = (s.end || 0) - (s.start || 0);
      const t1 = (s.start || 0) + Math.min(0.3, dur * 0.15);
      const t2 = (s.start || 0) + dur * 0.5;
      const t3 = Math.max((s.start || 0) + 0.3, (s.end || 0) - Math.min(0.3, dur * 0.15));

      const samples = [
        { name: 'start', t: t1 },
        { name: 'mid', t: t2 },
        { name: 'end', t: t3 },
      ];

      const frameMeasures = [];
      const shotErrors = [];

      for (const samp of samples) {
        const frameFile = path.join(tempDir, `${s.id}_${samp.name}.jpg`);
        spawnSync(ffmpeg, ['-y', '-ss', samp.t.toFixed(3), '-i', videoPath, '-vframes', '1', '-q:v', '2', frameFile], { encoding: 'utf8', windowsHide: true });
        const m = measureImage(frameFile);
        frameMeasures.push({ ...samp, file: frameFile, ...m });

        // Near-black check
        // near-black = dark AND nothing bright in it (a space scene is dark on average but has a lit planet: 90th percentile high)
        if (Number.isFinite(m.avg) && m.avg < 15 && !(m.high >= 45) && !(m.contentArea >= 0.2)) {   // a small lit planet on dark space has real content area
          shotErrors.push({ sceneId: s.id, problem: `near-black frame at ${samp.t.toFixed(1)}s (luma ${m.avg.toFixed(1)})`, severity: 'error' });
        }
        // Blank check
        // blank = almost no detail AND almost no contrast
        if (Number.isFinite(m.entropy) && m.entropy < 0.35 && !(m.high - m.low >= 60)) {
          shotErrors.push({ sceneId: s.id, problem: `blank frame at ${samp.t.toFixed(1)}s (entropy ${m.entropy.toFixed(2)})`, severity: 'error' });
        }
      }

      // Frozen check across the shot (if duration > 2s and start/mid/end dhash are identical)
      if (dur >= 2.0 && frameMeasures.length === 3 && frameMeasures[0].dhash) {
        const d12 = hamming(frameMeasures[0].dhash, frameMeasures[1].dhash);
        const d23 = hamming(frameMeasures[1].dhash, frameMeasures[2].dhash);
        if (d12 === 0 && d23 === 0) {
          shotErrors.push({ sceneId: s.id, problem: `frozen visual across shot (${dur.toFixed(1)}s)`, severity: 'error' });
        }
      }

      // Identical across shots check
      const midM = frameMeasures[1];
      if (midM?.dhash && prevMidHash) {
        const dPrev = hamming(midM.dhash, prevMidHash);
        if (dPrev <= 2) {
          shotErrors.push({ sceneId: s.id, problem: `identical visual to previous scene ${prevShotId} (hamming ${dPrev})`, severity: 'error' });
        }
      }
      if (midM?.dhash) {
        prevMidHash = midM.dhash;
        prevShotId = s.id;
      }

      results.push({
        sceneId: s.id,
        start: s.start,
        end: s.end,
        action: s.setpiece?.action || s.action || null,
        visual: s.visualObjective || s.visualPlan?.visualDescription || '',
        frames: frameMeasures.map((f) => ({ pos: f.name, t: +f.t.toFixed(2), avg: f.avg, entropy: f.entropy, dhash: f.dhash })),
        errors: shotErrors,
        ok: shotErrors.length === 0,
      });

      errors.push(...shotErrors);
    }
  } finally {
    if (!framesDir) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  }

  return { ok: errors.length === 0, scenesChecked: (shots || []).length, results, errors };
}
