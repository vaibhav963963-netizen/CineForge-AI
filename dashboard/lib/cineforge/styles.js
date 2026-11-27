// CineForge visual styles: the sets each style can use, and what each set is for. The planner may only choose a set that the
// selected style declares, so a Night File video never plans a kitchen and a Deep Dive video never plans a case wall.
// Browser-safe (no imports except vocab). The renderer for each style lives in engine/cineforge/src/styles/.
import { SETS } from './vocab.js';

export const STYLES = {
  'deep-dive': {
    label: 'Deep Dive 3D',
    sets: SETS,   // space, atmosphere, ground, kitchen, xray
    setHelp: {
      space: 'above or away from the planet',
      atmosphere: 'the entry layer around the planet',
      ground: 'the surface at the impact site',
      kitchen: 'a person at home (everyday people and their bodies)',
      xray: 'inside a person\'s body',
    },
  },
  'night-file': {
    label: 'Night File 3D',
    sets: ['corridor', 'house', 'casewall'],
    setHelp: {
      corridor: 'a long dark apartment corridor with one ceiling light (a person walking, waiting, or stopped at a door)',
      house: 'a house at night with one lit window and a streetlight (a person outside or at the window)',
      casewall: 'a corkboard case wall with pinned photos and red string (an investigator\'s board)',
    },
  },
};

export const DEFAULT_STYLE = 'deep-dive';

/** the sets a style can use; unknown styles are an error, never a silent fallback */
export function setsFor(style = DEFAULT_STYLE) {
  const s = STYLES[style];
  if (!s) throw new Error(`unknown style "${style}" (known: ${Object.keys(STYLES).join(', ')})`);
  return s.sets;
}
