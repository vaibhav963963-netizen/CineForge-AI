// Failure classification + recovery policy.
// Every failure is mapped to a class; the class decides whether to retry, how (backoff vs next slot vs next day),
// and whether it is permanent (no retry — straight to the dead-letter queue, a person must act).
export const CLASSES = {
  network:            { retry: true,  backoff: true,  label: 'Temporary network failure' },
  model_unavailable:  { retry: true,  backoff: true,  label: 'Model unavailable' },
  resources:          { retry: true,  backoff: false, label: 'Insufficient RAM or VRAM', waitForResources: true },
  disk:               { retry: true,  backoff: false, label: 'Insufficient disk space', waitForResources: true },
  research:           { retry: true,  backoff: true,  label: 'Research failure' },
  script_validation:  { retry: true,  backoff: false, label: 'Script validation failure', regenerate: 'script' },
  voice:              { retry: true,  backoff: true,  label: 'Voice generation failure' },
  visual:             { retry: true,  backoff: true,  label: 'Visual generation failure' },
  render:             { retry: true,  backoff: true,  label: 'Rendering failure' },
  youtube_auth:       { retry: false, backoff: false, label: 'YouTube OAuth failure (re-authorize once in Automation settings)' },
  youtube_quota:      { retry: true,  backoff: false, label: 'YouTube quota exhausted', untilNextDay: true },
  upload_interrupted: { retry: true,  backoff: true,  label: 'Upload interruption', resumable: true },
  studio_unavailable: { retry: true,  backoff: true,  label: 'CineForge studio not reachable' },
  cancelled:          { retry: false, backoff: false, label: 'Cancelled' },
  unknown:            { retry: true,  backoff: true,  label: 'Unknown failure' },
};

const RULES = [
  ['cancelled', /cancel/i],
  ['youtube_quota', /quota(exceeded| exceeded)|rateLimitExceeded|dailyLimitExceeded|youtube.*\b403\b.*quota/i],
  ['youtube_auth', /invalid_grant|unauthorized_client|invalid_client|token (has been )?(expired|revoked)|youtube.*\b401\b|insufficientPermissions|authorization required/i],
  ['upload_interrupted', /upload (was )?interrupted|resumable|ECONNRESET.*upload|upload.*(socket|timeout)/i],
  ['disk', /ENOSPC|no space left|disk (space|full)|insufficient (storage|disk)|free disk/i],
  ['resources', /out of memory|OOM|CUDA error: out of memory|VRAM|vk(Allocate|Queue).*(OUT_OF|DEVICE_LOST)|ErrorOutOfDeviceMemory|insufficient (RAM|memory)|free RAM/i],
  ['studio_unavailable', /studio (server )?(is )?not reachable|127\.0\.0\.1:\d+.*ECONNREFUSED|fetch failed.*:3\d\d\d/i],
  ['network', /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket hang up|network|fetch failed|getaddrinfo/i],
  ['model_unavailable', /local (script )?model|llama|script model HTTP|model (file )?not found|Gemma|engine.*not ready/i],
  ['script_validation', /Script v\d+|known factual error|would last about|proof-read|FAILED script|not (in|written in) (Hindi|Devanagari)|validation/i],
  ['research', /research/i],
  ['voice', /Kokoro|TTS|narration|voice\.py/i],
  ['visual', /ComfyUI|image generation|images?\b.*fail/i],
  ['render', /capture|FFmpeg|ffprobe|render|scene|Chrome|WebGL|compose/i],
];

export function classify(err) {
  const msg = String(err?.message || err || '');
  if (err?.failureClass && CLASSES[err.failureClass]) return err.failureClass;
  for (const [cls, re] of RULES) if (re.test(msg)) return cls;
  return 'unknown';
}

/**
 * When to try again. Returns { retry:false } for permanent failures or when attempts are exhausted
 * (→ dead-letter), else { retry:true, at } — the earliest allowed instant, never in quiet hours.
 *  · backoff classes: exponential (base × 2^(attempt-1), capped)
 *  · plus the configured retry slots: attempt 1 → +slot[0], attempt 2 → +slot[1], later → next recovery window
 *  · the later of the two wins; quota waits for the next day's production slot
 */
export function nextAttempt(cls, attempt, s, nowMs, helpers, firstAttemptMs = nowMs) {
  const c = CLASSES[cls] || CLASSES.unknown;
  if (!c.retry) return { retry: false, reason: `${c.label}: not retried automatically` };
  if (attempt > s.retryCount) return { retry: false, reason: `retry limit (${s.retryCount}) reached` };
  let at = nowMs;
  if (c.backoff) at = Math.max(at, nowMs + Math.min(s.backoffMaxSeconds, s.backoffBaseSeconds * 2 ** (attempt - 1)) * 1000);
  // retry slots are offsets from the FIRST attempt of this stage (08:00 → 08:30 → 10:00 → next recovery window)
  const slot = s.retrySlotsMinutes[attempt - 1];
  at = Math.max(at, slot != null ? firstAttemptMs + slot * 60000 : helpers.nextRecoveryWindow(nowMs + 60000, s));
  if (c.untilNextDay) at = Math.max(at, helpers.nextOccurrence(nowMs + 3600000, s.productionTime, s.productionDays, s.timeZone));
  if (helpers.inWindow(at, s.quietHours, s.timeZone)) at = helpers.nextOccurrence(at, s.quietHours.end, ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], s.timeZone);
  return { retry: true, at };
}
