// CineForge local render queue. One heavy render at a time (the RTX 3050 6 GB budget), up to MAX_ATTEMPTS per shot,
// completed shots are kept and never re-rendered on retry or resume. A shot that keeps failing is reported, not looped.
export const MAX_ATTEMPTS = 3;

/**
 * shots: planned shots. renderFn(shot, attempt) → result (throws on failure).
 * completed: Map of shotId → result from an earlier run (resume). Returns { results, failures, complete }.
 */
export async function runQueue(shots, renderFn, { completed = new Map(), onEvent = () => {} } = {}) {
  const results = new Map(completed);
  const failures = [];
  for (const shot of shots) {
    if (results.has(shot.id)) { onEvent({ type: 'skip', shotId: shot.id }); continue; }
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        results.set(shot.id, await renderFn(shot, attempt));
        lastError = null;
        onEvent({ type: 'done', shotId: shot.id, attempt });
        break;
      } catch (e) {
        lastError = e;
        onEvent({ type: 'retry', shotId: shot.id, attempt, error: e.message });
      }
    }
    if (lastError) failures.push({ shotId: shot.id, attempts: MAX_ATTEMPTS, error: lastError.message });
  }
  return { results, failures, complete: failures.length === 0 };
}
