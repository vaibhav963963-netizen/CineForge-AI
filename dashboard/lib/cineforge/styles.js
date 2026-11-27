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
  'inside-out': {
    label: 'Inside Out 2D',
    sets: ['room', 'xray', 'stomach'],
    setHelp: {
      room: 'a flat, bright room with a simple person (everyday action, reactions, speech)',
      xray: 'a flat x-ray view of a person\'s body with the bones and organs in cyan',
      stomach: 'inside the stomach, flat organs and the food travelling down (the thing that goes in and moves)',
    },
  },
  'paper-atlas': {
    label: 'Paper Atlas 2D',
    sets: ['hall', 'harbor', 'map'],
    setHelp: {
      hall: 'a historical hall on parchment with a figure in period dress (a merchant, a guard, a crowd)',
      harbor: 'a harbour on parchment with a ship moving across the water',
      map: 'a map on parchment with routes and places (where things happen)',
    },
  },
  'stick-story': {
    label: 'Stick Story 2D',
    sets: ['living', 'kitchen', 'hallway'],
    setHelp: {
      living: 'a flat living room with a couch, a lamp and a window (a stick person sitting, standing or reacting)',
      kitchen: 'a flat kitchen with a counter and a fridge (a stick person cooking, or stopped in shock)',
      hallway: 'a flat hallway with two doors (a stick person walking down it, or stopped at a door)',
    },
  },
  'tall-tale': {
    label: 'Tall Tale 3D',
    sets: ['street', 'interior', 'meadow'],
    setHelp: {
      street: 'a sunny small-town main street with shop fronts and the boardwalk (a person walking, talking, or reacting outside)',
      interior: 'an indoor shop with a counter, warm bulbs and a sign (a person at the counter, or a clerk)',
      meadow: 'an open meadow with a fence, trees and flowers (a person in the open, or a sunset)',
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
