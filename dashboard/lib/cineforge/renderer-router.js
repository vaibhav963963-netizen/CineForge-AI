// CineForge renderer router: chooses Three.js or Blender for each shot.
// A shot goes to Blender only if it needs a capability the Three.js renderer does not have. The capabilities Three.js
// implements are listed below; anything else in a shot (an effect or light it cannot draw) is a requirement for Blender.
// A requested renderer that is not available is an ERROR with a reason, never a silent switch.
export const RENDERERS = ['threejs', 'blender'];

// What the Three.js stage implements today (see stage-renderer.js). Extend this list when the renderer gains a capability.
export const THREEJS_EFFECTS = ['none', 'fire-plasma', 'debris', 'shockwave', 'dust-cloud'];
export const THREEJS_LIGHTING = ['sunlit', 'backlit-rim', 'night-ambient', 'fire-glow', 'plasma-glow'];

/** The capabilities a shot needs that the Three.js renderer lacks. Empty means Three.js can render it. */
export function missingThreejsCapabilities(shot) {
  const missing = [];
  if (shot.effect && !THREEJS_EFFECTS.includes(shot.effect)) missing.push(`effect:${shot.effect}`);
  if (shot.lighting && !THREEJS_LIGHTING.includes(shot.lighting)) missing.push(`lighting:${shot.lighting}`);
  return missing;
}

export function chooseRenderer(shot, { override = null, available = { threejs: true, blender: false } } = {}) {
  if (override) {
    if (!RENDERERS.includes(override)) return { renderer: null, error: `unknown renderer "${override}"` };
    if (!available[override]) return { renderer: null, error: `${override} was requested but is not available; not switching silently` };
    return { renderer: override, reason: 'manual override' };
  }
  const missing = missingThreejsCapabilities(shot);
  if (missing.length) {
    if (available.blender) return { renderer: 'blender', reason: `needs ${missing.join(', ')}, which Three.js does not implement` };
    return { renderer: null, error: `${shot.id} needs ${missing.join(', ')}; Three.js does not implement it and blender is not available` };
  }
  if (!available.threejs) return { renderer: null, error: 'no renderer available' };
  return { renderer: 'threejs', reason: 'rendered by the Three.js stage' };
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
