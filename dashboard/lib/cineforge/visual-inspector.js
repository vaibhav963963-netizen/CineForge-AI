// CineForge visual inspection. Works on MEASURED frame statistics (from stage-runner.js) and reports what it measured.
// It assigns no quality score: a finding is either a measured defect or it is not. Semantic checks (does the picture
// show what the narration says) belong to the Gemini QA step and are not claimed here.
//
// Definitions (from the spec's own list of checks):
//   blank           luma spread below BLANK_STD over the whole frame            → error
//   repeated frame  a frame identical to the previous one (no pixel change at all) inside a shot that must move → error
//   slow motion     a moving shot whose frames change very little (eased starts/ends are slow) → warning only
//   no subject      an active shot whose subject is not on screen              → error
//   missing shot    a planned shot with no rendered frames                     → error
// A change of shot is never counted as a repeat or a freeze.
export const BLANK_STD = 3;          // luma spread below this = a blank or near-blank frame
export const SLOW_CHANGE = 0.0002;   // share of pixels changed between frames below this = slow motion (warning)

const isMoving = (shot) => shot && (shot.motion !== 'stay' || shot.camera !== 'static');

/**
 * frames: [{ t, shotId, subject, std, diffFromPrev, changedFraction }] in time order. shots: planned shots.
 * Returns { ok, errors, warnings, counts } — ok only when there are no errors.
 */
export function inspectFrames(frames, shots) {
  const errors = [], warnings = [];
  const byId = new Map(shots.map((s) => [s.id, s]));
  let blank = 0, repeated = 0, slow = 0, noSubject = 0;

  for (const f of frames) {
    if (f.std < BLANK_STD) { blank++; errors.push(`t=${f.t}s looks blank (luma spread ${f.std})`); }
    if (f.shotId && !f.subject) { noSubject++; errors.push(`t=${f.t}s (${f.shotId}) has no subject on screen`); }
  }
  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1], cur = frames[i];
    if (!cur.shotId || cur.shotId !== prev.shotId) continue;   // a shot change is not a repeat
    if (!isMoving(byId.get(cur.shotId)) || cur.changedFraction === null) continue;
    if (cur.changedFraction === 0 && cur.diffFromPrev === 0) {
      repeated++; errors.push(`t=${cur.t}s (${cur.shotId}) repeats the previous frame exactly while the shot requires motion`);
    } else if (cur.changedFraction < SLOW_CHANGE) {
      slow++; warnings.push(`t=${cur.t}s (${cur.shotId}) changes little (${cur.changedFraction}); eased start or end, or slow motion`);
    }
  }
  for (const s of shots) {
    if (!frames.some((f) => f.shotId === s.id)) errors.push(`${s.id} has no rendered frames`);
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    counts: { frames: frames.length, shots: shots.length, blank, repeated, slow, noSubject },
  };
}
