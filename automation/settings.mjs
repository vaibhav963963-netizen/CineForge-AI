// Automation settings: defaults, validation and time-zone-aware slot computation (no external date library).
// These are USER settings (stored in the automation database, edited on the Automation page) — not .env values.
// Only the default studio URL comes from the central configuration (PORT / AUTOMATION_STUDIO_URL).
import { CONFIG } from '../dashboard/lib/config.js';
export const DEFAULTS = {
  enabled: false,                          // nothing runs until the user turns automation on
  timeZone: 'Asia/Kolkata',
  productionTime: '08:00',                 // local time in timeZone
  productionDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
  publishTime: '18:00',                    // independent of production
  publishDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
  maxVideosPerDay: 1,
  maxConcurrentJobs: 1,                    // RTX 3050 6 GB: one heavy job at a time
  retryCount: 3,
  retrySlotsMinutes: [30, 120],            // after the initial run: +30 min, +2 h, then the next recovery window
  backoffBaseSeconds: 60, backoffMaxSeconds: 3600,
  recoveryWindow: { start: '13:00', end: '16:00' },
  quietHours: { start: '23:00', end: '06:00' },   // no new heavy work starts in quiet hours
  minFreeDiskGB: 15,
  minFreeRamGB: 3,
  minFreeVramGB: 3,                        // another app holding the GPU (e.g. a game) → heavy stages wait
  eventRetentionDays: 30,                  // older events are pruned; the database is backed up daily (7 kept)
  publishMode: 'manual',                   // manual | private-upload | scheduled-public
  allowCatchUpPublishing: false,           // never publish several overdue videos together unless allowed
  scriptGate: 'ready',                     // ready = only READY scripts are rendered unattended | allow-needs-review (opt-in)
  topicSource: 'queue',                    // queue (user list) | trends
  topicQueue: [],
  studio: { url: CONFIG.AUTOMATION_STUDIO_URL, language: 'hi-conversational', personality: 'documentary', voice: 'hf_alpha', style: 'tall-tale', character: 'curious_student', durationSeconds: 45, visualMode: 'hybrid-local' },
};
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateSettings(s) {
  const e = [];
  const v = { ...DEFAULTS, ...s };
  try { new Intl.DateTimeFormat('en-US', { timeZone: v.timeZone }); } catch { e.push(`unknown time zone "${v.timeZone}"`); }
  for (const k of ['productionTime', 'publishTime']) if (!HHMM.test(v[k])) e.push(`${k} must be HH:MM`);
  for (const k of ['productionDays', 'publishDays']) if (!Array.isArray(v[k]) || !v[k].length || v[k].some((d) => !DAYS.includes(d))) e.push(`${k} must list days (${DAYS.join(', ')})`);
  for (const [k, lo, hi] of [['maxVideosPerDay', 1, 10], ['maxConcurrentJobs', 1, 1], ['retryCount', 0, 10], ['minFreeDiskGB', 1, 500], ['minFreeRamGB', 0, 64]]) if (!(Number.isInteger(v[k]) || k === 'minFreeRamGB') || v[k] < lo || v[k] > hi) e.push(`${k} must be ${lo}–${hi}`);
  if (!['manual', 'private-upload', 'scheduled-public'].includes(v.publishMode)) e.push('publishMode must be manual | private-upload | scheduled-public');
  if (!['ready', 'allow-needs-review'].includes(v.scriptGate)) e.push('scriptGate must be ready | allow-needs-review');
  for (const w of ['recoveryWindow', 'quietHours']) if (!HHMM.test(v[w]?.start || '') || !HHMM.test(v[w]?.end || '')) e.push(`${w} needs start/end HH:MM`);
  return { ok: !e.length, errors: e, value: v };
}

// ── time-zone helpers ────────────────────────────────────────────────────────────────────────────────────────────
/** wall-clock parts of an instant in a time zone */
export function zoned(ms, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, minutes: +p.hour * 60 + +p.minute, weekday: p.weekday.toLowerCase().slice(0, 3) };
}
/** the UTC instant of a local wall-clock time in a zone (handles DST by iterating on the offset) */
export function instantOf(dateStr, hhmm, timeZone) {
  const [y, mo, d] = dateStr.split('-').map(Number), [h, mi] = hhmm.split(':').map(Number);
  let t = Date.UTC(y, mo - 1, d, h, mi);
  for (let k = 0; k < 3; k++) {
    const z = zoned(t, timeZone), [zy, zm, zd] = z.date.split('-').map(Number);
    const diff = (Date.UTC(y, mo - 1, d, h, mi) - Date.UTC(zy, zm - 1, zd, Math.floor(z.minutes / 60), z.minutes % 60)) ;
    if (!diff) break; t += diff;
  }
  return t;
}
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
/** is the instant inside a [start, end) local window that may wrap past midnight */
export function inWindow(ms, win, timeZone) {
  const m = zoned(ms, timeZone).minutes, a = toMin(win.start), b = toMin(win.end);
  return a <= b ? m >= a && m < b : m >= a || m < b;
}
/** next occurrence (≥ fromMs) of a local time on allowed days */
export function nextOccurrence(fromMs, hhmm, days, timeZone) {
  for (let k = 0; k < 9; k++) {
    const day = zoned(fromMs + k * 86400000, timeZone);
    if (!days.includes(day.weekday)) continue;
    const t = instantOf(day.date, hhmm, timeZone);
    if (t >= fromMs) return t;
  }
  return null;
}
/** start of the next recovery window at or after fromMs */
export function nextRecoveryWindow(fromMs, s) {
  if (inWindow(fromMs, s.recoveryWindow, s.timeZone)) return fromMs;
  return nextOccurrence(fromMs, s.recoveryWindow.start, ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], s.timeZone);
}
