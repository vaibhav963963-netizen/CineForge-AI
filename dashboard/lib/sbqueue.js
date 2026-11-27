// Script Book queue pause state. Kept free of side effects (no server, no timers at import) so tests can use it without
// starting the studio. dashboard/server.js registers the queue tick as the resume handler.
let pausedUntil = 0;
let timer = null;
let onResume = () => {};

export function setQueueResumeHandler(fn) { onResume = typeof fn === 'function' ? fn : () => {}; }

export function isQueuePaused() { return Date.now() < pausedUntil; }
export function queuePausedUntil() { return pausedUntil; }

export function pauseScriptBookQueue(resetAt) {
  pausedUntil = resetAt;
  clearTimeout(timer);
  const waitMs = Math.max(0, resetAt - Date.now());
  if (waitMs > 0 && waitMs < 24 * 3600 * 1000) {
    timer = setTimeout(() => { pausedUntil = 0; onResume(); }, waitMs);
    timer.unref?.();
  }
}

export function resumeScriptBookQueue() {
  pausedUntil = 0;
  clearTimeout(timer);
  onResume();
}

export function getScriptBookQueueStatus() {
  return {
    paused: Date.now() < pausedUntil,
    pausedUntil: pausedUntil > 0 ? new Date(pausedUntil).toISOString() : null,
    remainingMs: Math.max(0, pausedUntil - Date.now()),
  };
}
