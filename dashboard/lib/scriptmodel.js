// The ONE place that decides which online provider writes scripts (SCRIPT_GENERATION_PROVIDER: gemini | groq).
// Every script-writing call in the studio goes through here; video production never imports it. There is no fallback
// between providers or to a local model: an unavailable provider stops script writing with its reason.
import { CONFIG } from './config.js';
import * as gemini from './gemini.js';
import * as groq from './groq.js';

const PROVIDERS = { gemini, groq };
export const PROVIDER = CONFIG.SCRIPT_GENERATION_PROVIDER;
const impl = () => { const p = PROVIDERS[PROVIDER]; if (!p) throw new Error(`unknown SCRIPT_GENERATION_PROVIDER "${PROVIDER}"`); return p; };
export const ensureReady = (...a) => impl().ensureReady(...a);
export const chat = (...a) => impl().chat(...a);
export const modelInfo = () => impl().modelInfo();
export const activity = { on: (ev, fn) => impl().activity.on(ev, fn), off: (ev, fn) => impl().activity.off(ev, fn) };
export const configuredModel = () => (PROVIDER === 'gemini' ? CONFIG.GEMINI_MODEL : CONFIG.GROQ_MODEL);
export const keyPresent = () => !!(PROVIDER === 'gemini' ? CONFIG.GEMINI_API_KEY : CONFIG.GROQ_API_KEY);
export const providerName = () => (PROVIDER === 'gemini' ? 'Google Gemini' : 'Groq');
