// Character registry: one folder per character (characters/<id>/index.js). Add or remove a character by adding
// or removing its folder and its line here. Shared by the renderer, the dashboard previews and the server.
import desi_hero from './desi_hero/index.js';
import desi_uncle from './desi_uncle/index.js';
import curious_student from './curious_student/index.js';
import indian_techie from './indian_techie/index.js';
import chanakya_scholar from './chanakya_scholar/index.js';
import authority_suit from './authority_suit/index.js';

export const CHARACTERS = { desi_hero, desi_uncle, curious_student, indian_techie, chanakya_scholar, authority_suit };
export const DESIGNS = Object.fromEntries(Object.entries(CHARACTERS).map(([k, c]) => [k, c.design]));
export const LOOKS = Object.fromEntries(Object.entries(CHARACTERS).map(([k, c]) => [k, c.looks]));
