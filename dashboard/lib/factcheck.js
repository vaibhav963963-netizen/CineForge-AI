// Fact grounding and claim review for generated scripts.
//
// The local model (Gemma 3 4B) invents plausible details: in the Roopkund test it placed the lake in "Panna National
// Park", gave skeleton counts as certainties and told the royal-procession legend as history. A 4B model cannot check
// itself, so accuracy comes from three deterministic layers around it:
//   1. topic fact files (facts/<id>.json in the workspace, local and editable) split into VERIFIED facts, THEORIES,
//      LEGENDS and KNOWN ERRORS; the prompt tells the model to state verified facts plainly, attribute theories, frame
//      legends as legends, and never repeat a known error. User-supplied facts are added as verified.
//   2. claim review after generation: every year, number, quantity, proper name and causal/historical event in the
//      script is checked against the fact file; anything not supported is flagged, known errors are flagged as
//      contradicted, and legend/theory content stated without a hedge is flagged as "stated as fact".
//   3. approval: a script with flagged claims cannot be rendered until the user reviews them (Script Studio).
import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from './workspace.js';

export const FACTS_DIR = path.join(PATHS.root || path.resolve('.'), 'facts');

const norm = (s) => String(s || '').toLowerCase().normalize('NFC').replace(/[’'`]/g, "'").replace(/[^\p{L}\p{M}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** all topic fact files */
export function listFactFiles() {
  try {
    return fs.readdirSync(FACTS_DIR).filter((f) => f.endsWith('.json')).map((f) => {
      try { const j = JSON.parse(fs.readFileSync(path.join(FACTS_DIR, f), 'utf8')); return { ...j, id: j.id || f.replace(/\.json$/, ''), file: `facts/${f}` }; } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

/** the fact file whose match keywords appear in the topic (most keyword hits wins), or null */
export function findTopicFacts(topic) {
  const t = ` ${norm(topic)} `;
  let best = null, bestHits = 0;
  for (const f of listFactFiles()) {
    const hits = (f.match || []).filter((k) => t.includes(` ${norm(k)} `) || t.includes(norm(k))).length;
    if (hits > bestHits) { best = f; bestHits = hits; }
  }
  return best;
}

const items = (arr) => (arr || []).map((x) => (typeof x === 'string' ? { text: x } : x));

/** prompt block: what may be stated plainly, what must be attributed, what must be framed as legend, what is wrong */
export function factsBlock(topicFacts, userFacts) {
  const parts = [];
  const verified = [...items(topicFacts?.verified).map((x) => x.text), ...(userFacts ? String(userFacts).split(/\n+/).map((s) => s.trim()).filter(Boolean) : [])];
  if (verified.length) parts.push(`VERIFIED FACTS (state these plainly; use ONLY these numbers, dates, names and places, never any other):\n${verified.map((s) => `- ${s}`).join('\n')}`);
  const th = items(topicFacts?.theories), lg = items(topicFacts?.legends), er = items(topicFacts?.knownErrors);
  const sci = th.filter((x) => !x.belief), bel = th.filter((x) => x.belief);
  if (sci.length) parts.push(`THEORIES (not proven: always attribute them, e.g. "scientists think", "one study suggests", "may have"):\n${sci.map((x) => `- ${x.text}`).join('\n')}`);
  if (bel.length) parts.push(`BELIEFS (no scientific evidence: always say "it is believed" / "माना जाता है"; NEVER credit them to scientists or science):\n${bel.map((x) => `- ${x.text}`).join('\n')}`);
  if (lg.length) parts.push(`LEGENDS (folklore, not history: always frame them, e.g. "legend says", "according to local folklore"):\n${lg.map((x) => `- ${x.text}`).join('\n')}`);
  if (er.length) parts.push(`KNOWN ERRORS (never state these):\n${er.map((x) => `- ${x.text}${x.correction ? ` → correct: ${x.correction}` : ''}`).join('\n')}`);
  if (topicFacts?.uncertain) parts.push(`UNCERTAIN: ${topicFacts.uncertain}`);
  return parts.join('\n\n');
}

// ── claim review ─────────────────────────────────────────────────────────────────────────────────────────────
const HEDGE = /\b(may|might|maybe|perhaps|possibly|probably|likely|believed|believe|thought|think|thinks|suggest|suggests|suggested|theory|theories|legend|legends|folklore|myth|myths|said to|says|according|some say|claim|claims|estimate|estimated|estimates|about|around|roughly|nearly|approximately|could)\b|कहा जाता|मान्यता|माना जाता|किंवदंती|कहानी|लोककथा|शायद|संभव|अनुमान|लगभग|करीब|कहते हैं|मानते/i;
const BELIEF_HEDGE = /\b(believed|believe|belief|tradition|traditionally|said to|people say|many say|according to (?:tradition|belief|folklore)|faith|claimed|claim|popularly)\b|माना जाता|मान्यता|कहा जाता|मानते हैं|मानते|मानना|लोग मानते|आस्था|परंपरा|दावा|विश्वास|कहते हैं/i;
const SCIENCE_CREDIT = /\b(scientists?|science|scientific(?:ally)?|research(?:ers)?|studies|study shows|proven|proved)\b|वैज्ञानिक|विज्ञान|शोध|रिसर्च|साबित/i;
const EVENT =/\b(caused|killed|died|perished|was built|were built|founded|invaded|conquered|led|crashed|found|discovered|proved|proven|confirmed|happened|struck|buried|murdered|sacrificed|cursed)\b|मारे गए|मौत|मृत्यु|खोज|मिले|पाया|बनाया|हमला|श्राप/i;
const STOP_CAPS = new Set('The A An In On At It Its This That These Those There Their They He She We You I But And Or So Yet Now Then Today Why How What When Where Who Which Imagine Did Do Does Was Were Is Are Even Every Each Some Many Most One Two Three Over Under After Before During Around About Nearly Scientists Researchers Experts Historians Legend Locals Hindu Hindus Indian Indians India'.split(' '));
const NUM_WORDS_RE = /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|hundreds|thousand|thousands)\b|(?<![ऀ-ॿ])(दो|तीन|चार|पांच|पाँच|छह|सात|आठ|नौ|दस|बीस|सौ|सैकड़ों|हज़ार|हजार)(?![ऀ-ॿ])/gi;   // units (crore, लाख, million) are checked with their number   // whole Hindi words only ("चारों ओर" is "around", not four)
// spoken English numbers → digits ("eight hundred" → 800, "five thousand twenty" → 5020) so they meet the facts
const UNITS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SMALL = String.raw`(?:(?:${Object.keys(TENS).join('|')})(?:[\s-](?:${Object.keys(UNITS).slice(0, 9).join('|')}))?|${Object.keys(UNITS).join('|')})`;
const SPOKEN_NUM = new RegExp(String.raw`\b(${SMALL})\s+(hundred|thousand)\b(?:\s+(?:and\s+)?(${SMALL})\b)?`, 'gi');
const small = (w) => w.toLowerCase().split(/[\s-]+/).reduce((a, x) => a + (TENS[x] || UNITS[x] || 0), 0);
// spoken years: "nineteen forty-two" → 1942, "twenty nineteen" → 2019, "nineteen oh five" → 1905
const YEAR_SPOKEN = new RegExp(String.raw`\b(eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+((?:${Object.keys(TENS).join('|')})(?:[\s-](?:${Object.keys(UNITS).slice(0, 9).join('|')}))?|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|(?:oh|o)[\s-](?:${Object.keys(UNITS).slice(0, 9).join('|')}))\b(?!\s+(?:hundred|thousand))`, 'gi');
// Hindi number words before a unit ("छह महीने", "आठ साल", "सात सेकंड") are numbers too
const HI_NUM = { 'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'छह': 6, 'छः': 6, 'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10, 'बारह': 12, 'बीस': 20, 'तीस': 30, 'चालीस': 40, 'पचास': 50 };
const HI_NUM_RE = new RegExp(`(^|[\\s,।])(${Object.keys(HI_NUM).join('|')})(?=\\s+(?:महीने|महीना|महीनों|साल|सालों|वर्ष|दिन|दिनों|सेकंड|घंटे|मिनट|किलो|किलोग्राम|मीटर))`, 'g');
export const spokenNumbersToDigits = (t) => String(t).replace(HI_NUM_RE, (m, pre, w) => pre + HI_NUM[w]).replace(YEAR_SPOKEN, (m, a, b) => String(small(a) * 100 + small(b.replace(/^o h?[\s-]|^oh[\s-]|^o[\s-]/i, '')))).replace(SPOKEN_NUM, (m, a, mult, b) => String(small(a) * (mult.toLowerCase() === 'hundred' ? 100 : 1000) + (b ? small(b) : 0)));
const DIGITS_DEVA = { '०': 0, '१': 1, '२': 2, '३': 3, '४': 4, '५': 5, '६': 6, '७': 7, '८': 8, '९': 9 };
const toAscii = (s) => String(s).replace(/[०-९]/g, (d) => DIGITS_DEVA[d]);
const numKey = (s) => toAscii(s).replace(/[,\s]/g, '').replace(/\.0+$/, '');

function corpusOf(topicFacts, userFacts) {
  const v0 = [...items(topicFacts?.verified).map((x) => x.text), ...items(topicFacts?.verified).flatMap((x) => x.keys || []), ...(topicFacts?.aliases || []), ...(topicFacts?.match || []), userFacts || ''].join(' \n ');
  // facts written in words count as numbers too ("about eight years" supports "8 साल")
  const v = `${v0} \n ${spokenNumbersToDigits(v0).replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty)\b(?=\s+(?:days?|months?|years?|groups?|people|hundred))/gi, (w) => String(UNITS[w.toLowerCase()] || TENS[w.toLowerCase()]))}`;
  const th0 = [...items(topicFacts?.theories), ...items(topicFacts?.legends)].map((x) => [x.text, ...(x.keys || [])].join(' ')).join(' \n ');
  const th = `${th0} \n ${spokenNumbersToDigits(th0).replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b(?=\s+(?:seconds?|days?|months?|years?))/gi, (w) => String(UNITS[w.toLowerCase()]))}`;
  // number → the unit classes it appears with in the verified facts ("100 million dollars" ≠ "₹100 crore")
  const verifiedUnits = new Map();
  for (const m of toAscii(v).matchAll(NUM_UNIT_RE)) { const k = numKey(m[1]); if (!verifiedUnits.has(k)) verifiedUnits.set(k, new Set()); verifiedUnits.get(k).add(unitClass(m[3])); }
  return { verified: norm(v), verifiedNums: new Set((toAscii(v).match(/\d[\d,]*(\.\d+)?/g) || []).map(numKey)), verifiedUnits, all: norm(`${v} ${th}`), allNums: new Set((toAscii(`${v} ${th}`).match(/\d[\d,]*(\.\d+)?/g) || []).map(numKey)), theoryNums: new Set((toAscii(th).match(/\d[\d,]*(\.\d+)?/g) || []).map(numKey)) };
}
const NUM_UNIT_RE = /[₹$]?(\d[\d,]*(\.\d+)?)\s?(%|crore|करोड़|lakh|लाख|million|मिलियन|billion|बिलियन|km|kg|metres|meters|m\b|feet|ft|days?|दिन|years?|साल|वर्ष|months?|महीने|महीना)?/gi;
const UNIT_CLASS = { 'करोड़': 'crore', 'लाख': 'lakh', 'मिलियन': 'million', 'बिलियन': 'billion', metres: 'm', meters: 'm', feet: 'ft', day: 'days', 'दिन': 'days', year: 'years', 'साल': 'years', 'वर्ष': 'years', month: 'months', 'महीने': 'months', 'महीना': 'months' };
const unitClass = (u) => { if (!u) return ''; const l = u.toLowerCase(); return UNIT_CLASS[l] || UNIT_CLASS[u] || l; };

// verified facts whose subject the line names (non-numeric keys of 4+ letters), each with the numbers it holds
function factSubjects(topicFacts, tn) {
  return items(topicFacts?.verified).map((x) => {
    const keys = (x.keys || []).filter((key) => !/\d/.test(key) && [...key].length >= 4).map(norm);
    const txt = toAscii(spokenNumbersToDigits(x.text));
    return { text: x.text, keys, nums: new Set((txt.match(/\d[\d,]*(\.\d+)?/g) || []).map(numKey)) };
  }).filter((s) => s.keys.some((key) => key && tn.includes(key)));
}

/**
 * Review every line. Returns { claims: [{ id, line, text, kind, value, status, note }], summary }.
 * status: supported (in the verified facts) | unverified (not in the facts: the user must check it) |
 *         contradicted (matches a known error) | needs-attribution (a theory/legend stated as fact)
 */
export function reviewClaims(script, { topic = '', topicFacts = null, userFacts = null } = {}) {
  const C = corpusOf(topicFacts, userFacts), haveFacts = !!(topicFacts || userFacts), claims = [];
  const topicWords = new Set(norm(`${topic} ${script.title || ''}`).split(' '));
  const add = (line, text, kind, value, status, note) => claims.push({ id: `L${line}-${claims.filter((c) => c.line === line).length + 1}`, line, text, kind, value, status, note });
  (script.lines || []).forEach((l, i) => {
    // the on-screen text is a claim too (seen: invented "₹2,000 – ₹10,000" and "90% temples" cards)
    const line = i + 1, t0 = [l.text, l.onScreen].filter((x) => x && String(x).trim()).join(' · '), t = spokenNumbersToDigits(t0), tn = norm(t0), hedged = HEDGE.test(t0);
    // known errors first: these are wrong regardless of anything else
    for (const e of items(topicFacts?.knownErrors)) {
      const keys = (e.keys || [e.text]).map(norm);
      if (keys.some((k) => k && tn.includes(k))) add(line, t, 'known error', e.text, 'contradicted', e.correction ? `Correct: ${e.correction}` : 'This is a known error for this topic.');
    }
    // legends / theories told as fact
    for (const [kind, arr] of [['legend', topicFacts?.legends], ['theory', topicFacts?.theories]]) {
      for (const x of items(arr)) {
        const keys = (x.keys || []).map(norm).filter(Boolean);
        if (!keys.length || !keys.some((k) => tn.includes(k))) continue;
        // a popular belief with no scientific support must be framed as a belief — crediting it to scientists or
        // "science" is a wrong attribution (seen: "वैज्ञानिकों का मानना है" for the seven-second-echo claim)
        if (x.belief) {
          const framed = BELIEF_HEDGE.test(t0), credited = SCIENCE_CREDIT.test(t0);
          if (!framed || credited) add(line, t, credited ? 'belief credited to science' : 'belief stated as fact', x.text, 'needs-attribution', 'This is a popular belief without scientific evidence: frame it as a belief ("it is believed …" / "माना जाता है …"), never as science.');
          continue;
        }
        if (!hedged) add(line, t, `${kind} stated as fact`, x.text, 'needs-attribution', kind === 'legend' ? 'Frame it as a legend ("legend says …").' : 'Attribute it ("scientists think …", "may have …").');
      }
    }
    // years and numbers
    const years = (toAscii(t).match(/\b(1[0-9]{3}|20[0-9]{2})\b/g) || []);
    for (const y of years) add(line, t, 'year', y, C.verifiedNums.has(y) ? 'supported' : 'unverified', C.verifiedNums.has(y) ? null : haveFacts ? 'Not in the verified facts for this topic.' : 'No fact file for this topic: check this year.');
    for (const m of toAscii(t).matchAll(NUM_UNIT_RE)) {
      const k = numKey(m[1]), ord = (toAscii(t).slice(m.index + m[0].length).match(/^(st|nd|rd|th)\b/i) || [''])[0];
      const n = m[0].trim() + ord;   // keep ordinals readable: "11th"
      if (years.includes(k) || !m[0].trim()) continue;
      // a unit that the facts never use with this number is a different claim ("₹100 crore" vs "100 million dollars")
      const units = C.verifiedUnits.get(k), u = unitClass(m[3]);
      // a number from a theory/belief/legend is fine when the line frames it that way ("कुछ मानते हैं … सात सेकंड")
      // (theory numbers only: a verified number with the wrong unit — "74 करोड़ डॉलर" for 74 million — must still fail)
      const framedTheoryNum = C.theoryNums.has(k) && !C.verifiedNums.has(k) && (hedged || BELIEF_HEDGE.test(t0)) && !SCIENCE_CREDIT.test(t0);
      let ok = framedTheoryNum || (!!units && (!u || units.has(u) || units.has('') && !['crore', 'lakh', 'million', 'billion'].includes(u)));
      // the number must belong to the subject the line talks about: "Gravity's budget was ₹450 crore" uses
      // Mangalyaan's cost (a verified number) for Gravity. When the line names a fact's subject (its non-numeric
      // keys) and none of those facts holds this number, it is attached to the wrong subject.
      let wrongSubject = null;
      // a currency sign on something that is not money ("₹298 दिन", "₹24 सितंबर") or two currencies at once
      // ("₹7.4 करोड़ डॉलर") is a garbled claim
      const after = toAscii(t).slice(m.index + m[0].length, m.index + m[0].length + 14);
      if (/^[₹$]/.test(m[0].trim()) && (['days', 'years', 'months'].includes(u) || /^\s*(january|february|march|april|may|june|july|august|september|october|november|december|जनवरी|फ़रवरी|फरवरी|मार्च|अप्रैल|मई|जून|जुलाई|अगस्त|सितंबर|अक्टूबर|नवंबर|दिसंबर)/i.test(after) || (/^₹/.test(m[0].trim()) && /डॉलर|dollar/i.test(after)))) {
        add(line, t, 'number', n, 'unverified', 'Currency sign on something that is not that amount of money (a date, a duration, or rupees and dollars together).');
        continue;
      }
      if (ok && !framedTheoryNum) {
        const subjects = factSubjects(topicFacts, tn);
        if (subjects.length && !subjects.some((s) => s.nums.has(k))) { ok = false; wrongSubject = subjects[0].text; }
      }
      const note = ok ? null : wrongSubject ? `This number belongs to a different fact. For this subject the verified fact is: "${wrongSubject}"` : units ?`The verified facts give ${k} with a different unit (${[...units].filter(Boolean).join(', ') || 'none'}).` : haveFacts ? 'Not in the verified facts for this topic.' : 'No fact file for this topic: check this number.';
      add(line, t, 'number', n, ok ? 'supported' : 'unverified', note);
    }
    for (const w of new Set((t.match(NUM_WORDS_RE) || []).map((x) => x.toLowerCase()))) {
      const ok = C.verified.includes(norm(w));
      add(line, t, 'quantity', w, ok ? 'supported' : 'unverified', ok ? null : 'Check this quantity.');
    }
    // proper names (people, places, organisations): an invented location is the commonest hallucination
    // a single capitalised word that opens a sentence is usually just a capital letter ("Heavy rain …"), not a name
    const names = [...t.matchAll(/\b[A-Z][\p{L}'’]+(?:\s+(?:of\s+|the\s+)?[A-Z][\p{L}'’]+)*/gu)]
      .filter((m) => !(m[0].split(/\s+/).length === 1 && /(^|[.!?।]\s*|["“'‘]\s*)$/.test(t.slice(0, m.index).trimEnd() === '' ? '' : t.slice(0, m.index))))
      .flatMap((m) => m[0].split(/['’]s\s+/))   // "Uttarakhand's Chamoli" → two names
      .map((n) => n.replace(/^(The|A|An)\s+/, '').replace(/['’]s?$/, ''))
      .filter((n) => n && !(n.split(/\s+/).length === 1 && STOP_CAPS.has(n)));
    for (const n of new Set(names)) {
      const nn = norm(n), inTopic = nn.split(' ').every((w) => topicWords.has(w));
      const stem = nn.replace(/(?:an|n|s)$/, '');   // "Himalayan" → "Himalaya" (in "Himalayas")
      const ok = C.verified.includes(nn) || (stem.length >= 5 && C.verified.includes(stem)) || inTopic;
      add(line, t, 'name / place', n, ok ? 'supported' : 'unverified', ok ? null : haveFacts ? 'Not in the verified facts: possibly invented.' : 'Check this name or place.');
    }
    // historical/causal events stated without a hedge ("a storm killed them") need a source
    if (EVENT.test(t) && !hedged) {
      const allNamesOk = claims.filter((c) => c.line === line && c.status !== 'supported').length === 0;
      const supported = haveFacts && allNamesOk && items(topicFacts?.verified).some((x) => (x.keys || []).some((k) => tn.includes(norm(k))));
      if (!supported) add(line, t, 'event', (t.match(EVENT) || [''])[0], 'unverified', 'An event stated as fact: confirm it, or attribute it ("scientists think …").');
    }
  });
  const count = (s) => claims.filter((c) => c.status === s).length;
  const summary = { factFile: topicFacts?.file || null, userFacts: !!userFacts, total: claims.length, supported: count('supported'), unverified: count('unverified'), contradicted: count('contradicted'), needsAttribution: count('needs-attribution') };
  summary.needsReview = summary.unverified + summary.contradicted + summary.needsAttribution;
  return { claims, summary };
}

// ── approval gate ────────────────────────────────────────────────────────────────────────────────────────────
/** claims that still block rendering for a script version's meta */
export function pendingClaims(meta) {
  const r = meta?.claimReview; if (!r) return [];
  const confirmed = new Set(meta.confirmedClaims || []);
  return r.claims.filter((c) => c.status !== 'supported' && !confirmed.has(c.id));
}

/** can this script version be rendered? */
export function claimsGate(meta) {
  const r = meta?.claimReview;
  if (!r) return { ok: true, reason: 'no claim review recorded (legacy script)' };
  const contradicted = r.claims.filter((c) => c.status === 'contradicted');
  if (contradicted.length) return { ok: false, contradicted, pending: pendingClaims(meta), message: `The script repeats ${contradicted.length} known factual error${contradicted.length > 1 ? 's' : ''} (${contradicted.map((c) => `line ${c.line}: ${c.note}`).join('; ')}). Edit those lines and save a new version.` };
  const pending = pendingClaims(meta);
  if (pending.length && !meta.claimsApproved) return { ok: false, pending, message: `${pending.length} factual claim${pending.length > 1 ? 's' : ''} need${pending.length > 1 ? '' : 's'} your review in Script Studio before rendering.` };
  return { ok: true };
}

/** the user confirms flagged claims (ids, or 'all'); known errors can never be confirmed */
export function confirmClaims(meta, ids) {
  const r = meta?.claimReview; if (!r) return { confirmedClaims: [], claimsApproved: true };
  const flagged = r.claims.filter((c) => c.status !== 'supported');
  const want = ids === 'all' ? flagged.map((c) => c.id) : (ids || []);
  const bad = flagged.filter((c) => c.status === 'contradicted' && want.includes(c.id));
  if (bad.length) throw Object.assign(new Error(`Known errors cannot be approved: ${bad.map((c) => `line ${c.line}: ${c.note}`).join('; ')}. Edit the script instead.`), { status: 409 });
  const confirmed = [...new Set([...(meta.confirmedClaims || []), ...want.filter((id) => flagged.some((c) => c.id === id))])];
  const remaining = flagged.filter((c) => !confirmed.includes(c.id));
  return { confirmedClaims: confirmed, claimsApproved: remaining.length === 0, claimsApprovedAt: remaining.length === 0 ? new Date().toISOString() : null };
}
