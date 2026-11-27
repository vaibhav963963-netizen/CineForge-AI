// CineForge asset registry. Every entry says where it came from and under what licence. Only "procedural" assets exist
// today (generated in code by stage-renderer.js), so nothing is downloaded and nothing depends on an online marketplace.
// Licensed glTF models can be added later with their licence and source recorded here.
export const ASSETS = [
  { id: 'proc.sphere', category: 'celestial', format: 'procedural', source: 'project code (stage-renderer.js)', license: 'project-original', renderers: ['threejs'], cost: 'low', scale: 1 },
  { id: 'proc.icosphere', category: 'objects', format: 'procedural', source: 'project code (stage-renderer.js)', license: 'project-original', renderers: ['threejs'], cost: 'low', scale: 1 },
  { id: 'proc.ground', category: 'environments', format: 'procedural', source: 'project code (stage-renderer.js)', license: 'project-original', renderers: ['threejs'], cost: 'low', scale: 80 },
];

const BY_ID = new Map(ASSETS.map((a) => [a.id, a]));

export function getAsset(id) { return BY_ID.get(id) || null; }

/** The subject meshes in stage-renderer.js use the icosphere; this is the asset a subject resolves to. */
export function assetForSubject() { return BY_ID.get('proc.icosphere'); }

/** Check a manifest: every asset has a licence, a source and at least one renderer. Returns { ok, errors }. */
export function validateManifest(list = ASSETS) {
  const errors = [];
  const seen = new Set();
  for (const a of list) {
    for (const k of ['id', 'category', 'format', 'source', 'license', 'cost']) if (!a[k]) errors.push(`${a.id || '?'}: missing ${k}`);
    if (!Array.isArray(a.renderers) || !a.renderers.length) errors.push(`${a.id}: no renderer listed`);
    if (seen.has(a.id)) errors.push(`${a.id}: duplicate id`);
    seen.add(a.id);
  }
  return { ok: errors.length === 0, errors };
}
