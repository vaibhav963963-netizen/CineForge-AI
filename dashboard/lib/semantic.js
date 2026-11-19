// Meaning preservation (Step 4). Verification only — nothing here rewrites a line.
//
// meaningDiff(original, rewrite)  deterministic first pass: what a rewrite dropped or changed, with a severity.
// semanticReview(...)             a narrow model check, used ONLY when the first pass is uncertain (content words were
//                                 dropped or added and none of the rules explains them); any failure → "unknown".
// verifyScriptMeaning(...)        the FINAL saved lines against the lines as fitting found them, with evidence.
//
// Real losses this was built from (Step 3 runs): "खून को पूरे शरीर में पहुंचाता है" → "खून पहुंचाता है" (destination);
// "बर्मूडा, फ्लोरिडा और पुर्तगाल के बीच" dropped (places); "गलतियाँ … दुर्घटनाओं का कारण बन सकती हैं" → "गलतियाँ … से होती
// हैं" (cause → origin, and "can" became a certainty); "शायद … मदद करता है" → "… पंप करता है" (a theory stated as fact).

const norm = (w) => String(w || '').toLowerCase().replace(/ँ/g, 'ं').replace(/़/g, '').replace(/[^\p{L}\p{M}\p{N}-]/gu, '');
const wordsOf = (t) => String(t || '').replace(/\b(you know|you see|of course)\b/gi, ' ').replace(/सच में|वाकई में|असल में|दरअसल/g, ' ').replace(/(\d),(\d)/g, '$1$2').split(/[\s,।?!.:;–—"“”'()]+/).map(norm).filter(Boolean);
const STOP = new Set(('है हैं था थे थी थीं का की के में से को ने पर और भी तो यह ये वह वो इस उस इसकी उसकी इसके उसके इसे उसे जो जब ' +
  'कि या लेकिन फिर अब हम सब नहीं हो होता होती होते जाता जाती जाते रहा रही रहे गया गई गए एक कोई अपनी अपना अपने आप ' +
  'the a an and or of to in on at is are was were be been it its this that these those for with by as from has have had ' +
  'into onto than then so but their his her they them which who what when there here also').split(' '));
// words whose loss never changes a fact (filler, emphasis, discourse)
const FILLER = new Set(('बहुत सच वाकई बिल्कुल ज़रा जरा सोचिए देखिए आइए दरअसल असल वास्तव सचमुच काफी काफ़ी बड़ी बड़ा बड़े छोटी तरह ' +
  'really very just actually truly quite simply basically indeed even now so').split(' ').map(norm));
// "बिना"/"without" adds a condition rather than flipping the meaning: if dropped, the semantic review decides
const NEG = new Set('नहीं न मत not no never none nothing cannot'.split(' ').map(norm));
const HEDGE = new Set(('शायद संभवतः संभव माना मानना मानते मानती अनुमान सकता सकती सकते कथित ' +
  'may might could perhaps probably possibly likely believe believed believes think thought suggests suggest theory legend reportedly').split(' ').map(norm));
const QUAL = new Set(('पूरे पूरा पूरी सारे सारा सारी सभी हर प्रत्येक केवल सिर्फ सिर्फ़ ज्यादातर ज़्यादातर अधिकतर कुछ कई हमेशा अक्सर कभी ' +
  'लगभग करीब बाकी अतिरिक्त सबसे ज्यादा ज़्यादा अधिक कम ' +
  'all every entire whole only most many some few always often sometimes usually about around nearly almost approximately roughly rest extra more less least').split(' ').map(norm));
const RELATION = new Set('कारण वजह परिणाम नतीजा इसलिए जिससे क्योंकि ताकि cause causes caused because due result results leads lead therefore'.split(' ').map(norm));
const DISCOURSE = new Set('फिर तो लेकिन और अब इसलिए so then but now and also'.split(' ').map(norm));
const GENERIC_PLACE = new Set('क्षेत्र इलाके इलाका इलाक़े यहाँ यहां वहाँ वहां जगह region area here there place'.split(' ').map(norm));
const VERBISH = /(ता|ती|ते|गा|गी|गे|ना|ने|नी)$/;
const isContent = (w) => w.length >= 2 && !STOP.has(w) && !/^\d/.test(w);

const stem = (w) => (/[a-z]/.test(w) ? w.replace(/(ies|es|s|ed|ing)$/, '') : w);
/** a word of the original is still present: same word, or the same stem with a different (inflected) ending */
function present(w, cand) {
  const s = stem(w), n = Math.max(3, Math.min(s.length, 6) - 2);
  return cand.some((c) => c === w || stem(c) === s || (s.length >= 4 && c.length >= 4 && c.slice(0, n) === s.slice(0, n)));
}
const count = (ws, set) => ws.filter((w) => set.has(w)).length;

// places / destinations: the word before a postposition (Hindi) or after a preposition (English)
function destinations(t) {
  const w = wordsOf(t), out = [];
  for (let i = 0; i < w.length; i++) {
    const head = w[i - 1], next = w[i + 1];
    if (head && isContent(head) && !QUAL.has(head) && !VERBISH.test(head)) {   // not a verbal noun ("करने में")
      if (w[i] === 'तक') out.push({ head, kind: 'destination', sev: 'high' });
      else if ((w[i] === 'के' || w[i] === 'की') && /^(बीच|ओर|तरफ|तरफ़)$/.test(next || '')) out.push({ head, kind: 'range/direction', sev: 'high' });
      else if ((w[i] === 'के' || w[i] === 'की') && /^(पास|अंदर|ऊपर|नीचे|बाहर)$/.test(next || '')) out.push({ head, kind: 'location', sev: 'medium' });
      else if (w[i] === 'में' || w[i] === 'पर') out.push({ head, kind: 'location', sev: 'medium' });
      else if (w[i] === 'को' && !/^(उस|इस|किस|जिस|आप|हम|मुझ|तुम)$/.test(head)) out.push({ head, kind: 'object', sev: 'high' });   // "खून को … पंप करते हैं" → "… पंप करता है" (object lost)
    }
    if (/^(to|into|onto|towards|toward|between|across|throughout|through|in|on|at)$/.test(w[i])) {
      const h = w.slice(i + 1).find((x) => isContent(x) && !QUAL.has(x));
      if (h) out.push({ head: h, kind: /^(in|on|at)$/.test(w[i]) ? 'location' : 'destination', sev: /^(in|on|at)$/.test(w[i]) ? 'medium' : 'high' });
    }
  }
  return out.map((d) => (GENERIC_PLACE.has(d.head) ? { ...d, sev: 'low' } : d));
}
// coordinated entities: "बर्मूडा, फ्लोरिडा और पुर्तगाल", "Florida and Puerto Rico"
function listMembers(t) {
  const s = String(t || ''), out = [];
  const member = (x) => { const w = norm(x); return isContent(w) && !VERBISH.test(w) && !HEDGE.has(w) ? w : null; };
  for (const m of s.matchAll(/([^\s,।.!?]+)\s*,\s*([^\s,।.!?]+)\s+(?:और|या|तथा|एवं|and|or)\s+([^\s,।.!?]+)/g)) out.push(...[m[1], m[2], m[3]].map(member).filter(Boolean).map((w) => ({ w, sev: 'high' })));
  for (const m of s.matchAll(/([^\s,।.!?]+)\s+(?:और|या|तथा|एवं|and|or)\s+([^\s,।.!?]+)/g)) out.push(...[m[1], m[2]].map(member).filter(Boolean).map((w) => ({ w, sev: 'medium' })));
  return out.filter((x, i, a) => a.findIndex((y) => y.w === x.w) === i);
}
const firstContent = (t) => wordsOf(t).find((w) => isContent(w) && !DISCOURSE.has(w) && !QUAL.has(w) && !FILLER.has(w) && !HEDGE.has(w) && !NEG.has(w));

/**
 * Deterministic meaning comparison of one line. Returns { changes:[{type, detail, severity}], dropped, added, uncertain }.
 * severity: high (meaning changed / a fact lost) · medium (a qualifier or entity lost) · low (generic, informational).
 * uncertain: content words were dropped or added that no rule explains → a semantic review is needed.
 */
export function meaningDiff(original, rewrite) {
  const A = wordsOf(original), B = wordsOf(rewrite), changes = [];
  const add = (type, detail, severity) => changes.push({ type, detail, severity });
  if (count(A, NEG) !== count(B, NEG)) add('negation', `negation ${count(A, NEG) > count(B, NEG) ? 'removed' : 'added'} (${[...A, ...B].filter((w) => NEG.has(w)).join(', ')})`, 'high');
  const hedgeLost = A.filter((w) => HEDGE.has(w) && !B.includes(w));
  if (hedgeLost.length && count(B, HEDGE) < count(A, HEDGE)) add('certainty', `an uncertain claim is now stated as fact (dropped: ${hedgeLost.join(', ')})`, 'high');
  if (count(B, HEDGE) > count(A, HEDGE)) add('certainty', `uncertainty added (${B.filter((w) => HEDGE.has(w) && !A.includes(w)).join(', ')})`, 'medium');
  const relLost = [...new Set(A.filter((w) => RELATION.has(w) && !B.includes(w)))];
  if (relLost.length && count(B, RELATION) < count(A, RELATION)) add('relationship', `cause-and-effect or relationship word dropped (${relLost.join(', ')})`, 'high');
  // counted: "कई दशकों से, कई जहाज़" → "कई दशकों से जहाज़" lost one "कई"
  const qualLost = [...new Set(A.filter((w) => QUAL.has(w) && count(A, new Set([w])) > count(B, new Set([w]))))];
  if (qualLost.length) add('qualifier', `qualifier dropped (${qualLost.join(', ')})`, 'medium');
  for (const d of destinations(original)) if (!present(d.head, B)) add(d.kind, `${d.kind} dropped ("${d.head}")`, d.sev);
  for (const m of listMembers(original)) if (!present(m.w, B)) add('entity', `listed entity dropped ("${m.w}")`, m.sev);
  // a whole clause dropped = a claim dropped (the 4B semantic review approved these in real runs: "…, पृथ्वी झुकी हुई है",
  // "…, समुद्र अशांत होते हैं", "– अटलांटिक महासागर का एक खास क्षेत्र –", "…, जो पानी से ऑक्सीजन खींचने के लिए छोटे फिल्टर हैं")
  for (const cl of String(original).split(/[,;:–—]|\.\.\.|…/)) {
    const cw = [...new Set(wordsOf(cl).filter((w) => isContent(w) && !FILLER.has(w)))];
    if (cw.length < 2) continue;
    const kept = cw.filter((w) => present(w, B)).length;
    if (kept / cw.length < 0.5) add('claim', `clause dropped or reduced ("${cl.trim().replace(/[।.!?]+$/, '')}")`, 'high');
  }
  const subj = firstContent(original);
  if (subj && !present(subj, B)) add('subject', `subject dropped or changed ("${subj}")`, 'high');
  const explained = new Set(changes.flatMap((c) => (c.detail.match(/"([^"]+)"|\(([^)]+)\)/g) || []).flatMap((x) => x.replace(/[()"]/g, '').split(/,\s*/))));
  const dropped = [...new Set(A.filter((w) => isContent(w) && !FILLER.has(w) && !present(w, B) && !explained.has(w)))];
  const added = [...new Set(B.filter((w) => isContent(w) && !FILLER.has(w) && !present(w, A)))];
  return { changes, dropped, added, uncertain: !changes.some((c) => c.severity !== 'low') && (dropped.length > 0 || added.length > 0) };
}
export const blocking = (d) => d.changes.filter((c) => c.severity === 'high' || c.severity === 'medium');

/**
 * Narrow model check for an UNCERTAIN rewrite. Verification only: it answers yes/no, it never proposes text.
 * Returns { verdict: 'same' | 'changed' | 'unknown', lost, error? }. Any error, cut-off or malformed answer → 'unknown'.
 */
export async function semanticReview({ original, rewrite, dropped = [], added = [], language = 'Hindi', chatFn, signal }) {
  const schema = { type: 'object', properties: { sameMeaning: { type: 'boolean' }, lost: { type: 'string', maxLength: 160 } }, required: ['sameMeaning', 'lost'], additionalProperties: false };
  const sys = [
    `You check whether a shortened ${language} sentence still says everything the original says. You do NOT rewrite anything.`,
    'Meaning is lost if any fact, person, place, destination, quantity, quality, condition, cause or effect, or who-does-what-to-whom is missing or changed. Removing only filler, emphasis or repetition does not lose meaning.',
    'Answer JSON: sameMeaning (true only if nothing is lost or changed) and lost (what is missing or changed, or "" if nothing).',
  ].join('\n');
  const user = `ORIGINAL: ${original}\nREWRITE: ${rewrite}${dropped.length ? `\nWords removed: ${dropped.join(', ')}` : ''}${added.length ? `\nWords added: ${added.join(', ')}` : ''}`;
  try {
    const { text, truncated } = await chatFn({ messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], schema, temperature: 0, maxTokens: 120, signal });
    if (truncated) return { verdict: 'unknown', lost: '', error: 'review answer cut off' };
    const j = JSON.parse(text);
    if (typeof j?.sameMeaning !== 'boolean') return { verdict: 'unknown', lost: '', error: 'malformed review answer' };
    // "same" with a stated loss is contradictory → not verified
    if (j.sameMeaning && String(j.lost || '').trim() && !/^(none|nothing|कुछ नहीं|-)$/i.test(String(j.lost).trim())) return { verdict: 'unknown', lost: String(j.lost), error: 'contradictory review answer' };
    return { verdict: j.sameMeaning ? 'same' : 'changed', lost: String(j.lost || '') };
  } catch (e) { if (signal?.aborted) throw e; return { verdict: 'unknown', lost: '', error: String(e.message).slice(0, 100) }; }
}

/** best supporting fact-file sentence for a line (by its Hindi terms → English keys), as evidence */
function evidenceFor(text, tf) {
  if (!tf) return null;
  const hiTerms = Object.entries(tf.terms?.hi || {}).filter(([, v]) => String(v).split('(')[0].trim().split(/\s+/).every((w) => String(text).includes(w))).map(([k]) => k.toLowerCase());
  const lt = String(text).toLowerCase();
  const scored = (tf.verified || []).map((v) => { const x = typeof v === 'string' ? { text: v, keys: [] } : v; const keys = (x.keys || []).map((k) => k.toLowerCase()); return { text: x.text, score: keys.filter((k) => hiTerms.some((h) => h.includes(k) || k.includes(h)) || lt.includes(k)).length }; }).filter((x) => x.score).sort((a, b) => b.score - a.score);
  return scored[0] ? { source: tf.file || tf.id, fact: scored[0].text } : null;
}

/**
 * The FINAL saved script against the lines as length fitting found them (meta.lengthFitBase). Deterministic: no model
 * call, no rewriting. Each changed line → { lineId, original, final, changes, uncertain, evidence, decision }.
 * decision: 'preserved' · 'needs review' (a high/medium change, or an uncertain change the fitting review did not clear).
 */
export function verifyScriptMeaning(config, value, topicFacts = null) {
  const lines = value.script.lines, base = value.meta?.lengthFitBase, hing = config.language.id === 'hinglish';
  if (!Array.isArray(base) || base.length !== lines.length) return { checked: 0, findings: [], ok: true, note: 'no fitting changes to verify' };
  const form = (l) => (hing ? (l.say || l.text) : l.text);
  const cleared = new Set((value.meta.lengthFitLog || []).filter((e) => e.meaning?.review?.verdict === 'same').map((e) => `${e.line}|${e.lines?.[0]?.say || e.lines?.[0]?.candidate || ''}`));
  const findings = [];
  lines.forEach((l, i) => {
    const fin = form(l), orig = base[i];
    if (!orig || fin === orig) return;
    const d = meaningDiff(orig, fin), block = blocking(d);
    const reviewed = cleared.has(`${i + 1}|${fin}`) || cleared.has(`${i + 1}|${l.text}`);
    const decision = block.length ? 'needs review' : d.uncertain && !reviewed ? 'needs review' : 'preserved';
    findings.push({ lineId: `L${i + 1}`, original: orig, final: fin, changes: d.changes, dropped: d.dropped, uncertain: d.uncertain, reviewedBy: reviewed ? 'semantic review (fitting)' : null, evidence: evidenceFor(orig, topicFacts), severity: block.some((c) => c.severity === 'high') ? 'high' : block.length ? 'medium' : d.uncertain && !reviewed ? 'uncertain' : 'none', decision });
  });
  return { checked: findings.length, findings, ok: findings.every((f) => f.decision === 'preserved') };
}
