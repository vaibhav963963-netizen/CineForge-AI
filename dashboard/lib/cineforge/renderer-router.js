// CineForge renderer router: chooses Three.js or Blender for each shot.
// Rules from the spec: quality and fidelity come first, within hardware limits. A requested renderer that is not
// available is an ERROR with a reason, never a silent switch. Blender is "unavailable" until its install is detected.
export const RENDERERS = ['threejs', 'blender'];

/** Simple, explainable preference. Blender is only chosen for shots that need physics, smoke/fire or close-up detail. */
const NEEDS_BLENDER = new Set(['impact']);   // the shot motions that need simulation-grade effects today

export function chooseRenderer(shot, { override = null, available = { threejs: true, blender: false } } = {}) {
  if (override) {
    if (!RENDERERS.includes(override)) return { renderer: null, error: `unknown renderer "${override}"` };
    if (!available[override]) return { renderer: null, error: `${override} was requested but is not available; not switching silently` };
    return { renderer: override, reason: 'manual override' };
  }
  if (NEEDS_BLENDER.has(shot.motion) && shot.camera === 'shake') {
    if (available.blender) return { renderer: 'blender', reason: 'impact with camera shake needs simulation-grade effects' };
    return { renderer: null, error: `${shot.id} needs blender (impact + shake) but blender is not available` };
  }
  if (!available.threejs) return { renderer: null, error: 'no renderer available' };
  return { renderer: 'threejs', reason: 'lightweight shot the Three.js renderer handles' };
}

/** Route every shot. Returns { plan: [{ shotId, renderer, reason }], errors }. */
export function routeShots(shots, opts = {}) {
  const plan = [], errors = [];
  for (const s of shots) {
    const r = chooseRenderer(s, opts);
    if (r.error) errors.push(r.error);
    else plan.push({ shotId: s.id, renderer: r.renderer, reason: r.reason });
  }
  return { plan, errors };
}
