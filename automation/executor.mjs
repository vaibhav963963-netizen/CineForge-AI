// CineForge automation — production executor: drives the existing studio over its local API, one stage at a time.
// Each stage returns { fields, data }: fields are saved on the run, data in the stage checkpoint.
//   topic → script (generate + gates) → render (the SAVED script version: never regenerated) → qa (ffprobe + sha256)
//   → metadata → upload → publish → record
// Upload/publish use automation/youtube.mjs (P3). Until YouTube is authorised, use publishMode "manual".
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, setCheckpoint } from './db.mjs';
import { buildHashtags, buildTags, buildDescription, buildSrt, validatePublishMeta } from './publish-meta.mjs';
import { extractCover } from './cover.mjs';
import { chooseFormat, recentFormats, similarTopic } from './variety.mjs';
import { getCatalog } from '../dashboard/lib/catalog.js';
import { chat } from '../dashboard/lib/llm.js';
import { CONFIG } from '../dashboard/lib/config.js';
import { getQualityInspector, getCorrectionEngine, assertPublishable } from '../quality-gate/index.js';


const fail = (msg, failureClass) => Object.assign(new Error(msg), failureClass ? { failureClass } : {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── studio client ─────────────────────────────────────────────────────────────────────────────────────────────────
export function studioClient(base) {
  const api = async (p, opts = {}) => {
    let r;
    try { r = await fetch(base + p, { ...opts, headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(opts.timeout || 30000) }); }
    catch (e) { throw fail(`studio server not reachable at ${base} (${e.cause?.code || e.message})`, 'studio_unavailable'); }
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    if (!r.ok) throw fail(`studio ${r.status} ${p}: ${(j?.error?.message || j?.message || t).toString().slice(0, 300)}`);
    return j;
  };
  return {
    api,
    async healthy() { try { await api('/api/catalog', { timeout: 5000 }); return true; } catch { return false; } },
    /** start the studio server if it is down (detached, survives the scheduler) and wait until it answers */
    async ensure(log = () => {}) {
      if (await this.healthy()) return;
      const port = new URL(base).port || String(CONFIG.PORT);
      log(`Studio not running — starting it on port ${port}`);
      const out = fs.openSync(path.join(ROOT, 'logs', 'server.out'), 'a');
      spawn(process.execPath, [path.join(ROOT, 'dashboard', 'server.js')], { cwd: ROOT, env: { ...process.env, PORT: port }, detached: true, stdio: ['ignore', out, out], windowsHide: true }).unref();
      for (let k = 0; k < 60; k++) { await sleep(2000); if (await this.healthy()) return; }
      throw fail(`studio server did not start on port ${port} within 2 minutes`, 'studio_unavailable');
    },
    /** poll a studio job to a terminal state; studio stage failures keep their message for classification */
    async waitJob(jobId, { log = () => {}, timeoutMin = 120 } = {}) {
      const end = Date.now() + timeoutMin * 60000; let last = '', misses = 0;
      while (Date.now() < end) {
        // the studio can be busy for a while (final QA is CPU-heavy): a missed poll is retried for up to 5 minutes, not a failure
        let j;
        try { j = await api(`/api/jobs/${jobId}`); misses = 0; }
        catch (e) { if (e.failureClass === 'studio_unavailable' && ++misses * 5 < 300) { await sleep(5000); continue; } throw e; }
        const line = `${j.status} ${j.progress ?? ''}% ${j.currentStageName || ''}`;
        if (line !== last) { log(`studio job ${jobId}: ${line}`); last = line; }
        if (j.status === 'completed') return j;
        if (j.status === 'failed') throw fail(`Failed during ${j.failedStageName || j.currentStageName || 'studio job'}: ${j.error?.message || j.error || j.message}`);
        if (j.status === 'cancelled') throw fail('studio job cancelled', 'cancelled');
        await sleep(5000);
      }
      throw fail(`studio job ${jobId} did not finish within ${timeoutMin} min`, 'render');
    },
  };
}

// ── ffprobe (independent final QA) ────────────────────────────────────────────────────────────────────────────────
function ffprobe(file) {
  const exe = [path.join(ROOT, 'runtime', 'ffmpeg', 'bin', 'ffprobe.exe'), 'ffprobe'].find((p) => p === 'ffprobe' || fs.existsSync(p));
  const r = spawnSync(exe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', file], { encoding: 'utf8' });
  if (r.status !== 0) throw fail(`ffprobe failed on ${file}: ${(r.stderr || r.error?.message || '').slice(0, 200)}`, 'render');
  return JSON.parse(r.stdout);
}
const sha256 = (file) => new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });

// ── executor ──────────────────────────────────────────────────────────────────────────────────────────────────────
export function createExecutor({ db, settings, youtube = null }) {
  const studio = () => studioClient(settings().studio.url);
  // the format chosen for this video (topic stage) decides the style, tone, voice, language and length; settings are the fallback
  const input = (s, topic, f = null) => ({ topic, language: f?.language || s.studio.language, personality: f?.personality || s.studio.personality, voice: f?.voice || s.studio.voice, style: f?.style || s.studio.style, character: f?.character || s.studio.character, durationSeconds: f?.durationSeconds || s.studio.durationSeconds, visualMode: s.studio.visualMode });
  const formatOf = (cps) => cps?.topic?.data?.format || null;
  // what this automated video is made with, shown on the Create page while it runs
  const originOf = (s, run, cps) => { const f = formatOf(cps) || {}; return { source: 'automation', runId: run.id, style: f.style || s.studio.style, personality: f.personality || s.studio.personality, voice: f.voice || s.studio.voice, language: f.language || s.studio.language, durationSeconds: f.durationSeconds || s.studio.durationSeconds, character: f.character || s.studio.character, why: f.why || null }; };
  const voicesList = () => { try { return getCatalog().voices || []; } catch { return []; } };
  const yt = async () => youtube || (await import('./youtube.mjs').catch(() => null));

  return {
    // topic: the next queued topic that is NOT a near-duplicate of an earlier video; the format is chosen automatically
    async topic(run, { settings: s, log }) {
      const history = db.prepare('SELECT topic FROM runs WHERE topic IS NOT NULL AND id != ?').all(run.id).map((r) => r.topic);
      const pool = (s.topicQueue || []).map((t) => String(t).replace(/^\s*\d+[.)]\s+/, '').trim()).filter(Boolean);   // strip list numbers typed by hand
      let topic = null;
      for (const t of pool) {
        const sim = similarTopic(t, history);
        if (sim) { log(`Skipped "${t}": too similar to an earlier video ("${sim.topic}")`); continue; }
        topic = t; break;
      }
      if (!topic) throw fail(pool.length ? 'every queued topic is too similar to an earlier video — add a new topic' : 'the topic queue is empty — add topics in the Automation settings', 'research');
      const format = await chooseFormat(topic, recentFormats(db), getCatalog(), chat);
      if (s.topicQueue?.includes(topic)) db.prepare("INSERT INTO settings (key, value) VALUES ('topicQueue', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(s.topicQueue.filter((t) => t !== topic)));
      // the topic list keeps every topic; this one is now made
      const hist = (s.topicHistory || []).map((h) => (String(h.topic).toLowerCase() === topic.toLowerCase() && h.status === 'waiting' ? { ...h, status: 'made', runId: run.id, madeAt: new Date().toISOString() } : h));
      db.prepare("INSERT INTO settings (key, value) VALUES ('topicHistory', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(hist));
      log(`Topic: ${topic} · ${format.style} · ${format.personality} · ${format.language} · ${format.voice} · ${format.character} · ${format.durationSeconds} s — ${format.why}`);
      return { fields: { topic }, data: { topic, source: 'queue', format } };
    },

    // script: generate in the studio (research, plan, write, validate); unattended gate policy
    async script(run, { settings: s, log, checkpoints }) {
      const c = studio(); await c.ensure(log);
      const sub = await c.api('/api/scripts/preview', { method: 'POST', body: JSON.stringify({ input: input(s, run.topic, formatOf(checkpoints)), origin: originOf(s, run, checkpoints), requestKey: `auto-${run.id}-script-${run.attempt}` }) });
      const jobId = sub.jobId || sub.job?.id, projectId = sub.projectId || sub.project?.id;
      updateStudio(db, run.id, jobId);
      const j = await c.waitJob(jobId, { log, timeoutMin: 45 });
      const version = j.result?.version;
      const sv = await c.api(`/api/projects/${projectId}/scripts/${version}`);
      const status = sv.meta?.status || 'NEEDS_REVIEW';
      const failed = Object.entries(sv.meta?.gates || {}).filter(([, g]) => !g.ok).map(([k, g]) => `${k}: ${(g.issues || [])[0] || ''}`);
      if (status === 'FAILED') throw fail(`script validation: v${version} FAILED (${failed.join('; ').slice(0, 300)})`, 'script_validation');
      if (status !== 'READY' && s.scriptGate !== 'allow-needs-review') throw fail(`script validation: v${version} needs review (${failed.join('; ').slice(0, 300)})`, 'script_validation');
      // the gates passed (or the user allowed NEEDS_REVIEW): confirm remaining claims as automation, approve the version
      const gate = await c.api(`/api/projects/${projectId}/scripts/${version}/claims`);
      if (gate.gate?.contradicted?.length) throw fail(`script validation: v${version} repeats a known factual error`, 'script_validation');
      if (!gate.gate?.ok) await c.api(`/api/projects/${projectId}/scripts/${version}/claims`, { method: 'POST', body: JSON.stringify({ confirm: 'all', by: 'automation' }) });
      await c.api(`/api/projects/${projectId}/scripts/${version}/approve`, { method: 'POST', body: '{}' });
      log(`Script v${version} ${status} — approved for render`);
      return { fields: { project_id: projectId, script_version: version }, data: { projectId, version, status, title: sv.title, gates: Object.fromEntries(Object.entries(sv.meta?.gates || {}).map(([k, g]) => [k, g.ok])) } };
    },

    // render: the SAVED script version (no regeneration); studio stage failures are classified by message
    async render(run, { settings: s, log, checkpoints }) {
      if (!run.project_id || !run.script_version) throw fail('render: no approved script version on this run', 'script_validation');
      const c = studio(); await c.ensure(log);
      const sub = await c.api('/api/jobs', { method: 'POST', body: JSON.stringify({ input: input(s, run.topic, formatOf(checkpoints)), origin: originOf(s, run, checkpoints), projectId: run.project_id, scriptVersion: run.script_version, requestKey: `auto-${run.id}-render-${run.attempt}` }) });
      const jobId = sub.jobId || sub.job?.id;
      updateStudio(db, run.id, jobId);
      const j = await c.waitJob(jobId, { log, timeoutMin: 120 });
      if (j.result?.approval?.decision === 'REJECTED') throw fail(`render rejected by quality checks: ${(j.result.approval.reasons || []).slice(0, 3).join('; ').slice(0, 300)}`, 'render');
      const p = j.result?.exportAbsolutePath || (j.result?.exportPath && path.join(ROOT, j.result.exportPath));
      if (!p) throw fail('render finished without an export path', 'render');
      return { fields: { video_path: p }, data: { jobId, exportPath: j.result.exportPath, durationSeconds: j.result.durationSeconds, qa: j.result.qa?.status || null } };
    },

    // qa: independent of the studio — the file exists, has video + audio, the duration is within tolerance,
    // and full multi-level AI Quality Gate inspection (visual, animation, interactions, audio, captions)
    async qa(run, { settings: s, checkpoints, log = () => {} }) {
      if (!run.video_path || !fs.existsSync(run.video_path)) throw fail(`final QA: video file missing (${run.video_path})`, 'render');
      const info = ffprobe(run.video_path), dur = +info.format?.duration;
      const v = info.streams?.find((x) => x.codec_type === 'video'), a = info.streams?.find((x) => x.codec_type === 'audio');
      if (!v || !a) throw fail('final QA: the video must have a video and an audio stream', 'render');
      const T = formatOf(checkpoints)?.durationSeconds || s.studio.durationSeconds;
      if (!(dur > 5) || Math.abs(dur - T) > T * 0.2) throw fail(`final QA: duration ${dur?.toFixed?.(1)} s is not within 20 % of ${T} s`, 'render');
      const hash = await sha256(run.video_path);

      let qualityReport = null;
      if (CONFIG.QUALITY_GATE_ENABLED) {
        log(`Running AI Video Quality Gate on ${path.basename(run.video_path)}...`);
        const projectDir = run.project_id ? path.join(ROOT, 'projects', run.project_id) : path.dirname(path.dirname(run.video_path));
        const inspector = getQualityInspector();
        qualityReport = await inspector.inspectVideo(run.video_path, { projectDir, projectId: run.project_id, targetSeconds: T });

        if (qualityReport.status === 'BLOCKED_BY_QUOTA') {
          throw fail(`Quality Gate: Gemini free-tier quota exhausted. Publishing blocked to enforce zero cost.`, 'youtube_quota');
        }

        if (qualityReport.status !== 'PASS') {
          // Attempt automatic correction if within max retries
          const correction = getCorrectionEngine();
          const plan = correction.generateCorrectionPlan(qualityReport, projectDir);
          if (plan.canRetry && (run.attempt || 0) < CONFIG.QUALITY_GATE_MAX_RETRIES) {
            log(`Quality Gate detected issues (score: ${qualityReport.overallScore}/${CONFIG.QUALITY_GATE_MIN_SCORE}). Generating targeted corrections for ${plan.failedScenesCount} scene(s)...`);
            await correction.applyCorrection(projectDir, plan);
          }
          throw fail(`Quality Gate ${qualityReport.status} (score: ${qualityReport.overallScore}/${CONFIG.QUALITY_GATE_MIN_SCORE}): ${(qualityReport.reasons || []).join('; ')}`, 'quality_gate_failed');
        }
        log(`Quality Gate PASS (score: ${qualityReport.overallScore}/100, verified free model: ${qualityReport.modelId})`);
      }

      return {
        fields: { video_sha: hash },
        data: {
          durationSeconds: +dur.toFixed(2),
          video: `${v.codec_name} ${v.width}x${v.height}`,
          audio: a.codec_name,
          sha256: hash,
          qualityScore: qualityReport?.overallScore || 100,
          qualityReport: qualityReport || null,
        },
      };
    },

    // metadata: title, hashtags, description, tags, cover image and captions — everything is built and checked here,
    // before any upload. A missing or invalid item stops the run at this stage (nothing is uploaded).
    async metadata(run, { settings: s, checkpoints }) {
      const c = studio(); await c.ensure();
      const sv = await c.api(`/api/projects/${run.project_id}/scripts/${run.script_version}`);
      const title = String(sv.title || run.topic).replace(/\s+/g, ' ').trim().slice(0, 95);
      const lang = formatOf(checkpoints)?.language || s.studio.language;   // the language this Short was made in
      const hashtags = buildHashtags({ title, topic: run.topic, language: lang });
      const meta = {
        title: `${title} ${hashtags[0]}`.slice(0, 100), hashtags,
        description: buildDescription({ lines: sv.lines, hashtags, language: lang }),
        tags: buildTags({ hashtags, topic: run.topic }), categoryId: '27',
        defaultLanguage: lang.startsWith('hi') ? 'hi' : 'en', madeForKids: false, containsSyntheticMedia: true,
      };
      const check = validatePublishMeta(meta);
      if (!check.ok) throw fail(`publishing metadata invalid: ${check.problems.join('; ')}`, 'metadata');
      // captions from the narration's real timings (lines.json written by the render)
      const dir = path.join(ROOT, 'projects', run.project_id);
      let linesJson; try { linesJson = JSON.parse(fs.readFileSync(path.join(dir, 'audio', 'lines.json'), 'utf8')); } catch { throw fail('captions: audio/lines.json is missing for this project', 'metadata'); }
      const srt = buildSrt(linesJson.lines || linesJson);
      if (!srt.ok) throw fail(`captions invalid: ${srt.problems.slice(0, 3).join('; ')}`, 'metadata');
      const srtFile = path.join(dir, 'publish', 'captions.srt');
      fs.mkdirSync(path.dirname(srtFile), { recursive: true }); fs.writeFileSync(srtFile, srt.srt, 'utf8');
      // cover image: one frame from the finished MP4, checked for brightness and contrast
      if (!run.video_path || !fs.existsSync(run.video_path)) throw fail('cover: the rendered MP4 is missing', 'render');
      const cover = extractCover(run.video_path, path.join(dir, 'publish', 'cover.jpg'));
      if (!cover.ok) throw fail(`cover image: no usable frame (${cover.tried.map((t) => `${t.at}s ${t.problem}`).join('; ')})`, 'metadata');
      return { data: { ...meta, captionsFile: srtFile, captionCues: srt.cues, captionLanguage: lang.startsWith('hi') ? 'hi' : 'en', coverFile: cover.file, coverAt: cover.at } };
    },

    async upload(run, ctx) {
      if (CONFIG.QUALITY_GATE_ENABLED) {
        const qr = ctx.checkpoints?.qa?.data?.qualityReport;
        try {
          assertPublishable({ videoPath: run.video_path, qualityReport: qr, currentRun: run });
        } catch (err) {
          throw fail(`Publishing BLOCKED by Quality Gate: ${err.message}`, 'quality_gate_failed');
        }
      }
      const y = await yt();
      if (!y?.upload) throw fail('YouTube publishing is not set up yet (authorization required)', 'youtube_auth');
      const m = ctx.checkpoints?.metadata?.data;
      if (!m) throw fail('upload: the metadata stage did not finish', 'metadata');
      const r = await y.upload(run, { ...ctx, db });
      // the video is on YouTube now: attach the cover and captions; a failure here does NOT re-upload the video
      const vid = r.data?.videoId || run.youtube_video_id;
      const parts = {};
      for (const [name, fn] of [['thumbnail', () => y.setThumbnail(vid, m.coverFile)], ['captions', () => y.uploadCaptions(vid, fs.readFileSync(m.captionsFile, 'utf8'), { language: m.captionLanguage })]]) {
        try { parts[name] = { ok: true, detail: await fn() }; } catch (e) { parts[name] = { ok: false, detail: e.message, failureClass: e.failureClass || 'unknown' }; }
      }
      setCheckpoint(db, run.id, 'publish-parts', Object.values(parts).every((p) => p.ok) ? 'done' : 'partial', parts);
      if (!Object.values(parts).every((p) => p.ok)) throw fail(`video uploaded (${vid}); attaching ${Object.entries(parts).filter(([, p]) => !p.ok).map(([k, p]) => `${k} failed: ${p.detail}`).join('; ')}`, 'publish_parts');
      return r;
    },
    async publish(run, ctx) {
      const y = await yt();
      if (!y?.confirmPublished) throw fail('YouTube publishing is not set up yet (authorization required)', 'youtube_auth');
      return y.confirmPublished(run, { ...ctx, db });
    },
    async record(run) {
      return { data: { topic: run.topic, project: run.project_id, script: run.script_version, video: run.video_path, sha256: run.video_sha, youtube: run.youtube_url, publishedAt: new Date().toISOString() } };
    },

    // emergency stop: cancel the studio job this run is waiting on
    async cancel(run) {
      if (!run.studio_job_id) return;
      try { await studio().api(`/api/jobs/${run.studio_job_id}/cancel`, { method: 'POST', body: '{}' }); } catch {}
    },
  };
}
function updateStudio(db, runId, jobId) { db.prepare('UPDATE runs SET studio_job_id = ? WHERE id = ?').run(jobId, runId); }
