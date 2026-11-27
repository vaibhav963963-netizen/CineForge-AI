// CineForge style registry. A style is chosen by the page URL (?style=deep-dive or ?style=night-file). An unknown style is an
// error: nothing falls back silently to another look.
import { deepDive } from './deep-dive.js';
import { nightFile } from './night-file.js';
import { tallTale } from './tall-tale.js';
import { insideOut } from './inside-out.js';
import { paperAtlas } from './paper-atlas.js';
import { stickStory } from './stick-story.js';

const STYLES = Object.fromEntries([deepDive, nightFile, tallTale, insideOut, paperAtlas, stickStory].map((s) => [s.id, s]));

export function getStyle(id) {
  const s = STYLES[id];
  if (!s) throw new Error(`unknown style "${id}" (known: ${Object.keys(STYLES).join(', ')})`);
  return s;
}
export const STYLE_IDS = Object.keys(STYLES);
