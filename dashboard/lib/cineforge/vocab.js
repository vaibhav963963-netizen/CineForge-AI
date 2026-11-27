// CineForge closed vocabularies. Dependency-free on purpose: this file is also loaded by the browser renderer.
// Everything the planner may choose is listed here; anything else is rejected by validation.

// camera movement
export const CAMERA_MOVES = ['static', 'push', 'pull', 'orbit', 'track', 'crane', 'shake', 'aerial'];

// framing / shot size (sets the camera distance and lens)
export const SHOT_SIZES = ['extreme-wide', 'wide', 'medium', 'close-up', 'extreme-close-up'];

// what the main subject physically does
export const MOTIONS = ['stay', 'approach', 'recede', 'cross', 'rise', 'fall', 'impact'];

// lighting look for the shot
export const LIGHTING = ['sunlit', 'backlit-rim', 'night-ambient', 'fire-glow', 'plasma-glow'];

// physical effects rendered as particles or meshes
export const EFFECTS = ['none', 'fire-plasma', 'debris', 'shockwave', 'dust-cloud'];

// how this shot begins (the transition INTO it from the previous shot)
export const TRANSITIONS = ['cut', 'dissolve', 'fade-black'];

// a shot must do something visible: a subject motion or a physical effect (camera moves alone are not enough)
export const MIN_SHOTS_PER_SEGMENT = 3;
export const MAX_SHOTS_PER_SEGMENT = 6;
