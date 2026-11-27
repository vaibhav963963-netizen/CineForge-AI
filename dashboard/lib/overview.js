// Dashboard numbers, computed from the studio's real records only: project folders, studio job history and the
// automation database. Nothing is estimated or invented; a source that cannot be read is reported as unavailable.

const IST_OFFSET_MS = 330 * 60000;   // India time: production days and charts are shown in IST
const DAYS = 14;

/** YYYY-MM-DD in India time for an ISO timestamp or epoch ms */
export function istDay(value) {
  const t = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(t)) return null;
  return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** the last `n` IST days, oldest first, ending today */
export function lastDays(n = DAYS, now = Date.now()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(istDay(now - i * 86400000));
  return out;
}

/** count items per key, sorted by count (largest first) */
function tally(items, keyOf) {
  const m = new Map();
  for (const it of items) { const k = keyOf(it); if (k == null || k === '') continue; m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const round1 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);

function videoOverview(projects, days) {
  const exported = projects.filter((p) => p.hasVideo);
  const seconds = exported.map((p) => Number(p.render?.durationSeconds) || 0).filter((s) => s > 0);
  const perDay = Object.fromEntries(days.map((d) => [d, 0]));
  for (const p of projects) { const d = istDay(p.createdAt); if (d && d in perDay) perDay[d]++; }
  return {
    total: projects.length,
    exported: exported.length,
    qaApproved: projects.filter((p) => p.qa?.approval?.decision === 'APPROVED').length,
    totalSeconds: round1(sum(seconds)),
    averageSeconds: seconds.length ? round1(sum(seconds) / seconds.length) : null,
    byDay: days.map((d) => ({ day: d, count: perDay[d] })),
    languages: tally(exported, (p) => p.config?.language?.name),
    styles: tally(exported, (p) => p.config?.visual?.styleName),
    personalities: tally(exported, (p) => p.config?.narration?.personalityName),
    characters: tally(exported, (p) => p.config?.visual?.characterName),
    // target length vs the length each exported Short really came out at (newest 15)
    durations: [...exported].sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)).slice(0, 15).reverse().map((p) => ({
      id: p.id, title: p.title, target: Number(p.config?.durationSeconds) || null, actual: round1(Number(p.render?.durationSeconds) || null),
    })),
    statuses: tally(projects, (p) => p.status),
    latest: [...projects].sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)).slice(0, 8).map((p) => ({
      id: p.id, title: p.title, status: p.status, hasVideo: !!p.hasVideo, createdAt: p.createdAt,
      language: p.config?.language?.name || null, style: p.config?.visual?.styleName || null, seconds: p.render?.durationSeconds || null,
      qa: p.qa?.approval?.decision || null, coverUrl: p.coverUrl || null,
    })),
  };
}

const LIVE = new Set(['queued', 'running']);

function jobOverview(jobs) {
  const finished = jobs.filter((j) => j.finishedAt && j.startedAt);
  const secs = finished.map((j) => j.elapsedSeconds ?? (Date.parse(j.finishedAt) - Date.parse(j.startedAt)) / 1000).filter((s) => s >= 0);
  return {
    total: jobs.length,
    statuses: tally(jobs, (j) => j.status),
    averageSeconds: secs.length ? round1(sum(secs) / secs.length) : null,
    // jobs happening right now, with their live progress
    active: jobs.filter((j) => LIVE.has(j.status)).map((j) => ({
      id: j.jobId || j.id, title: j.title || j.projectId || '', kind: j.kind || null, status: j.status,
      progress: round1(j.progress), stage: j.currentStageName || null, stageProgress: j.stageProgress ?? null,
      elapsedSeconds: j.elapsedSeconds ?? null, etaSeconds: j.estimatedRemainingSeconds ?? null, message: j.message || '',
    })),
    // the last 20 finished jobs, oldest first: how long each really took
    timings: finished.slice(0, 20).reverse().map((j) => ({
      id: j.jobId || j.id, title: j.title || j.projectId || '', kind: j.kind || null, status: j.status,
      seconds: round1(j.elapsedSeconds ?? (Date.parse(j.finishedAt) - Date.parse(j.startedAt)) / 1000), at: j.finishedAt,
    })),
    recent: jobs.slice(0, 8).map((j) => ({ id: j.jobId || j.id, kind: j.kind || null, status: j.status, message: j.message || '', createdAt: j.createdAt })),
  };
}

function automationOverview(db, days, now) {
  const runs = db.prepare('SELECT id, status, stage, topic, youtube_video_id, youtube_url, publish_at, last_error, failure_class, created_at, updated_at FROM runs ORDER BY created_at DESC').all();
  const queueRow = db.prepare("SELECT value FROM settings WHERE key = 'topicQueue'").get();
  let queue = 0; try { queue = Array.isArray(JSON.parse(queueRow?.value || '[]')) ? JSON.parse(queueRow.value).length : 0; } catch {}
  const isPublished = (r) => !!r.youtube_video_id;
  const isScheduled = (r) => isPublished(r) && r.publish_at && Date.parse(r.publish_at) > now;
  const isFailed = (r) => r.status === 'dead' || r.status === 'failed';
  const published = runs.filter(isPublished), failed = runs.filter(isFailed);
  const scheduled = runs.filter(isScheduled);
  const live = published.filter((r) => !isScheduled(r));
  // in progress = still being made or waiting to upload (an uploaded run counts once, under published)
  const inProgress = runs.filter((r) => !isPublished(r) && ['queued', 'running', 'waiting_retry', 'awaiting_publish'].includes(r.status));
  const perDay = Object.fromEntries(days.map((d) => [d, { made: 0, published: 0, failed: 0 }]));
  for (const r of runs) {
    const d = istDay(r.created_at); if (!d || !(d in perDay)) continue;
    perDay[d].made++; if (isPublished(r)) perDay[d].published++; if (isFailed(r)) perDay[d].failed++;
  }
  const finishedCount = published.length + failed.length;
  return {
    total: runs.length,
    published: published.length,
    live: live.length,
    scheduled: scheduled.length,
    inProgress: inProgress.length,
    failed: failed.length,
    queue,
    successRate: finishedCount ? Math.round((published.length / finishedCount) * 100) : null,
    byDay: days.map((d) => ({ day: d, ...perDay[d] })),
    statuses: tally(runs, (r) => r.status),
    stages: tally(inProgress, (r) => r.stage),
    recent: runs.slice(0, 10).map((r) => ({ id: r.id, topic: r.topic, status: r.status, stage: r.stage, youtubeUrl: r.youtube_url, publishAt: r.publish_at, createdAt: r.created_at })),
    failures: failed.slice(0, 6).map((r) => ({ id: r.id, topic: r.topic, failureClass: r.failure_class, error: (r.last_error || '').slice(0, 240), at: r.updated_at })),
  };
}

/**
 * @param {{ projects: object[], jobs: object[], db: object|null, now?: number }} input
 * @returns the whole dashboard payload; `automation` is null when its database cannot be read
 */
export function overview({ projects = [], jobs = [], db = null, now = Date.now() }) {
  const days = lastDays(DAYS, now);
  let automation = null, automationError = null;
  if (db) { try { automation = automationOverview(db, days, now); } catch (e) { automationError = e.message; } }
  else automationError = 'automation database not open';
  return {
    generatedAt: new Date(now).toISOString(),
    days,
    videos: videoOverview(projects, days),
    jobs: jobOverview(jobs),
    automation,
    automationError,
  };
}
