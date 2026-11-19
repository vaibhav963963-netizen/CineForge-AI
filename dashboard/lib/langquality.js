// Language quality (Step 5): VALIDATION is separate from CORRECTION.
//
// languageIssues(config, script)   deterministic grammar / consistency checks per line → [{ line, rule, severity, detail, fix? }]
//   severity: error (wrong grammar a native speaker would notice) · warning (unnatural or inconsistent) · note (editorial)
// mechanicalFix(text, issues)       only unambiguous, meaning-free fixes ("करते है" → "करते हैं", a doubled word)
// correctLanguage(config, value)    errors left after mechanical fixes → one-line model correction, accepted ONLY if the
//                                   error is gone, nothing new appeared, and meaningDiff finds no change at all (no
//                                   model self-approval); otherwise the original stays and the issue is reported.
//
// No topic-specific rules: the noun-gender lexicon below holds common everyday Hindi nouns only.
import { meaningDiff, blocking } from './semantic.js';

const norm = (w) => String(w || '').replace(/[^\p{L}\p{M}\p{N}-]/gu, '');
const words = (t) => String(t || '').split(/[\s,।?!.:;–—"“”'()]+/).map(norm).filter(Boolean);

// common nouns whose gender is fixed (masculine / feminine) — general vocabulary, not topic terms
const MASC = new Set('दिल खून पानी जहाज़ जहाज समुद्र महासागर देश शहर रास्ता सूरज चाँद चांद तारा ग्रह आसमान पेड़ घर दिन साल महीना समय सवाल जवाब रहस्य इतिहास राजा शरीर दिमाग़ दिमाग मस्तिष्क हिस्सा कारण नतीजा परिणाम वैज्ञानिक लोग इंसान बच्चा व्यापार पहाड़ किनारा तूफ़ान तूफान बादल मौसम रंग प्रोटीन टीका'.split(' '));
const FEM = new Set('पृथ्वी धरती दुनिया धारा नदी हवा बारिश रफ़्तार रफ्तार गति कहानी बात चीज़ चीज जगह सड़क रात सुबह शाम ज़मीन जमीन रोशनी आग ऊर्जा ताक़त ताकत ज़िंदगी जिंदगी मौत बीमारी दवा कोशिका ऑक्सीजन सेना लड़ाई जंग खोज भाषा किताब आवाज़ आवाज लहर मछली सदी सभ्यता'.split(' '));
// adjectives that inflect: base (masc sg) → [masc sg, fem, masc pl/oblique]
const ADJ = ['बड़ा', 'छोटा', 'नया', 'पुराना', 'अच्छा', 'बुरा', 'लंबा', 'ऊँचा', 'गहरा', 'पूरा', 'सारा', 'अगला', 'पिछला', 'पहला', 'दूसरा', 'तीसरा', 'ठंडा', 'गरम', 'काला', 'नीला', 'हरा', 'पीला', 'सफ़ेद', 'खारा', 'मीठा', 'अजीब', 'ख़ास'].filter((a) => /ा$/.test(a));
const adjForm = (w) => { for (const a of ADJ) { const s = a.slice(0, -1); if (w === a) return 'm'; if (w === `${s}ी`) return 'f'; if (w === `${s}े`) return 'mp'; } return null; };
const POSTP = new Set('का की के को से में पर तक ने'.split(' '));

/** Hindi (Devanagari) grammar checks on one line */
function hindiIssues(t) {
  const out = [], w = words(t), s = String(t);
  const add = (rule, severity, detail, fix) => out.push({ rule, severity, detail, ...(fix ? { fix } : {}) });
  // 1. auxiliary agreement: plural/oblique participle + singular "है", singular masc participle + plural "हैं"
  for (const m of s.matchAll(/(\S+ते)\s+है(?=[\s,।!?]|$)/g)) add('verb agreement', 'error', `"${m[0]}" — a plural verb needs "हैं"`, { from: m[0], to: `${m[1]} हैं` });
  for (const m of s.matchAll(/(\S+ता)\s+हैं(?=[\s,।!?]|$)/g)) if (!/^(आप|हम)$/.test(w[w.indexOf(norm(m[1])) - 1] || '')) add('verb agreement', 'error', `"${m[0]}" — a singular masculine verb takes "है"`, { from: m[0], to: `${m[1]} है` });
  for (const m of s.matchAll(/(\S+ते)\s+था(?=[\s,।!?]|$)/g)) add('verb agreement', 'error', `"${m[0]}" — a plural verb needs "थे"`, { from: m[0], to: `${m[1]} थे` });
  for (const m of s.matchAll(/(\S+ता)\s+थे(?=[\s,।!?]|$)/g)) add('verb agreement', 'error', `"${m[0]}" — a singular verb takes "था"`, { from: m[0], to: `${m[1]} था` });
  // 2. a habitual verb with no auxiliary ("…पंप करता, जो पानी से ऑक्सीजन लेता।") reads as broken Hindi in narration
  // (a NEGATIVE habitual correctly drops है: "बारिश नहीं होती", "हमेशा अंधेरा नहीं होता"; a clause before a comma that
  //  shares the next clause's auxiliary is only a warning: "मजबूत करते, … सुरक्षित रखते हैं")
  for (const m of s.matchAll(/(\S{2,}(?:ता|ती|ते))(?=\s*([,।]|\s[-–—]\s)|\s*$)/g)) {   // also before a dash: "…टुकड़े दिखाता - वायरस या प्रोटीन।"
    const prev = w[w.indexOf(norm(m[1])) - 1] || '';
    if (/^(नहीं|न|कभी)$/.test(prev)) continue;
    const atComma = m[2] === ',' || /[-–—]/.test(m[2] || ''), laterAux = /(है|हैं|था|थे|थी)\s*[।!?]?\s*$/.test(s.slice(m.index + m[0].length));
    // common verb stems + habitual ending (a stem list, so nouns like "रास्ते", "जनता", "धरती" are never matched)
    if (/^(रह|सक|जा|हो|कर|ले|दे|आ|बह|बन|लग|पहुँचा|पहुंचा|खींच|भेज|दिखा|बता|बना|रख|चल|मिल|सिखा|बचा|समझा|ला|पा|घूम|बढ़|गिर|उठ|सोच|बदल|फैल|टकरा|पंप कर|बच|मार|खा|पी|सो|जी|डूब|उड़|तैर|बोल|सुन|देख)(ता|ती|ते)$/.test(norm(m[1])) && !/^(जैसे|मानो)$/.test(prev))
      add('verb form', atComma && laterAux ? 'warning' : 'error', `"${m[1]}" has no auxiliary — say "${m[1]} है/हैं" (or "था/थे")`);
  }
  // 3. genitive and adjective gender with a known noun ("का धारा", "बड़ी दिल")
  for (let i = 0; i < w.length - 1; i++) {
    const a = w[i], n = w[i + 1].replace(/ों$|ें$|एँ$/, '');
    if (a === 'का' && FEM.has(w[i + 1])) add('gender agreement', 'error', `"का ${w[i + 1]}" — "${w[i + 1]}" is feminine: "की ${w[i + 1]}"`, { from: `का ${w[i + 1]}`, to: `की ${w[i + 1]}` });
    if (a === 'की' && MASC.has(w[i + 1]) && !POSTP.has(w[i + 2] || '')) add('gender agreement', 'error', `"की ${w[i + 1]}" — "${w[i + 1]}" is masculine: "का ${w[i + 1]}"`, { from: `की ${w[i + 1]}`, to: `का ${w[i + 1]}` });
    const g = adjForm(a);
    if (g === 'f' && MASC.has(n) && n === w[i + 1]) add('gender agreement', 'error', `"${a} ${w[i + 1]}" — "${w[i + 1]}" is masculine`);
    if (g === 'm' && FEM.has(n) && n === w[i + 1]) add('gender agreement', 'error', `"${a} ${w[i + 1]}" — "${w[i + 1]}" is feminine`);
  }
  // subject directly followed by its verb: "पृथ्वी घूमता है", "दिल धड़कती है"
  // sentence-initial noun only: after a comma the subject is often implied and the noun is the object
  // ("…पंप करता, ऑक्सीजन खींचता है", "रक्त ऑक्सीजन लेता है")
  for (const m of s.matchAll(/^(\S+)\s+(\S+)(ता|ती)\s+(है|था|थी)(?=[\s,।!?]|$)/g)) {
    const noun = norm(m[1]), gv = m[3];
    if (FEM.has(noun) && gv === 'ता') add('subject-verb gender', 'error', `"${noun} … ${m[2]}${gv}" — "${noun}" is feminine: "${m[2]}ती"`);
    if (MASC.has(noun) && gv === 'ती') add('subject-verb gender', 'error', `"${noun} … ${m[2]}${gv}" — "${noun}" is masculine: "${m[2]}ता"`);
  }
  // 4. doubled postposition or word ("से से", "में में", "का के", "है है")
  for (let i = 0; i < w.length - 1; i++) {
    if (w[i] === w[i + 1] && (POSTP.has(w[i]) || /^(है|हैं|था|और)$/.test(w[i]))) add('repeated word', 'error', `"${w[i]} ${w[i + 1]}" — word repeated`, { from: `${w[i]} ${w[i + 1]}`, to: w[i] });
    else if (POSTP.has(w[i]) && POSTP.has(w[i + 1]) && /^(का|की|के)$/.test(w[i]) && /^(का|की|के)$/.test(w[i + 1])) add('case marker', 'error', `"${w[i]} ${w[i + 1]}" — two genitive markers in a row`);
  }
  return out;
}

/** English grammar checks on one line */
function englishIssues(t) {
  const out = [], s = String(t);
  const add = (rule, severity, detail, fix) => out.push({ rule, severity, detail, ...(fix ? { fix } : {}) });
  for (const m of s.matchAll(/\b(a)\s+([aeio][a-z]+)/gi)) if (!/^(one|once|uni|use|usu|euro|eu)/i.test(m[2])) add('article', 'error', `"${m[0]}" → "an ${m[2]}"`, { from: m[0], to: `${m[1] === 'A' ? 'An' : 'an'} ${m[2]}` });
  for (const m of s.matchAll(/\b(an)\s+([bcdfgjklmnpqrstvwxyz][a-z]+)/gi)) if (!/^(hour|honest|honou?r|heir)/i.test(m[2])) add('article', 'error', `"${m[0]}" → "a ${m[2]}"`, { from: m[0], to: `${m[1] === 'An' ? 'A' : 'a'} ${m[2]}` });
  for (const m of s.matchAll(/\b(\w+)\s+\1\b/gi)) if (!/^(that|had|very|bye|no)$/i.test(m[1])) add('repeated word', 'error', `"${m[0]}" — word repeated`, { from: m[0], to: m[1] });
  for (const m of s.matchAll(/\b(they|we|you|people|scientists|these|those)\s+(is|was|has)\b/gi)) add('subject-verb agreement', 'error', `"${m[0]}" — plural subject`);
  for (const m of s.matchAll(/\b(he|she|it|this|that)\s+(are|were|have)\b/gi)) add('subject-verb agreement', 'error', `"${m[0]}" — singular subject`);
  for (const m of s.matchAll(/\b(it|he|she)\s+(don't|do not)\b/gi)) add('subject-verb agreement', 'error', `"${m[0]}" → "${m[1]} doesn't"`);
  if (/^[a-z]/.test(s.trim())) add('capitalisation', 'warning', 'the sentence starts with a lowercase letter');
  // comma splice: two complete clauses joined by a bare comma ("The decline unfolded slowly over centuries, a gradual
  // change occurred."). Both sides need a finite verb, so "Around 1900 BCE, many cities were…" is not flagged.
  const FIN = /\b(is|are|was|were|has|have|had|did|does|do|can|could|will|would|may|might|must|\w{3,}ed)\b/i;
  const parts = s.replace(/[.!?]\s*$/, '').split(/,\s+/);
  for (let k = 1; k < parts.length; k++) {
    const left = parts.slice(0, k).join(', '), right = parts[k];
    if (/^(and|but|or|so|yet|which|who|whom|whose|where|when|while|because|although|though|leading|making|causing|as|if|then|that)\b/i.test(right)) continue;
    if (/^\w+ing\b/i.test(right)) continue;   // participle phrase ("…, leading to …")
    const subj = /^(the|a|an|this|that|these|those|it|they|we|he|she|people|many|some|scientists|cities|[A-Z][a-z]+)\b/.test(right);
    // hyphenated "-ed" words are adjectives ("a well-organized society"), not verbs
    const verbish = (x) => x.split(/\s+/).filter((w) => !w.includes('-')).join(' ');
    if (subj && FIN.test(verbish(left)) && FIN.test(verbish(right.split(/\s+/).slice(1, 5).join(' ')))) { add('comma splice', 'error', `"…${left.split(' ').slice(-3).join(' ')}, ${right.split(' ').slice(0, 4).join(' ')}…" — two sentences joined by a comma: use a full stop, "and" or "so"`); break; }
  }
  return out;
}

/** script-level consistency: the same word spelled two ways (nukta / chandrabindu / anusvara), and an unclear opening */
function scriptIssues(config, lines) {
  const out = [], deva = config.language.script === 'Deva' || config.language.id === 'hinglish';
  if (deva) {
    const key = (w) => w.replace(/़/g, '').replace(/ँ/g, 'ं');
    const forms = new Map();
    lines.forEach((t, i) => words(t).forEach((w) => { if (!/[ऀ-ॿ]/.test(w) || w.length < 3) return; const k = key(w); if (!forms.has(k)) forms.set(k, new Map()); const f = forms.get(k); f.set(w, [...(f.get(w) || []), i + 1]); }));
    for (const [, f] of forms) if (f.size > 1) { const v = [...f]; out.push({ line: v[1][1][0], rule: 'spelling consistency', severity: 'warning', detail: `spelled two ways in one script: ${v.map(([w, l]) => `"${w}" (line ${l.join(', ')})`).join(' and ')} — use one spelling` }); }
  }
  // the first line cannot start with a pronoun that refers to nothing yet
  const first = words(lines[0] || '')[0] || '';
  if (/^(यह|वह|ये|वो|इसका|उसका|it|this|they|he|she)$/i.test(first)) out.push({ line: 1, rule: 'unclear reference', severity: 'warning', detail: `the script opens with "${first}" — the viewer does not know yet what it refers to` });
  return out;
}

/** All language issues of a script (validation only). Lines are checked in the form that is spoken. */
export function languageIssues(config, script) {
  const hing = config.language.id === 'hinglish', hi = config.language.code === 'hi';
  const lines = script.lines.map((l) => String(hing ? (l.say || l.text) : l.text));
  const per = lines.flatMap((t, i) => (hi ? hindiIssues(t) : englishIssues(t)).map((x) => ({ line: i + 1, ...x })));
  return [...per, ...scriptIssues(config, lines)];
}

/** apply only the unambiguous fixes that carry a { from, to } (agreement of the auxiliary, a doubled word, a/an) */
export function mechanicalFix(text, issues) {
  let t = String(text);
  for (const x of issues) if (x.fix && t.includes(x.fix.from)) t = t.replace(x.fix.from, x.fix.to);
  return t;
}

/**
 * Correct language ERRORS without touching meaning. Mechanical fixes first (no model); then, for an error that remains,
 * one model request per line that names the exact problem. A correction is kept only when:
 *  · the targeted error is gone and no new error appears;
 *  · meaningDiff finds NO change at all (no dropped/added content word, entity, number, certainty or cause) — the
 *    model is never asked whether its own correction is good;
 *  · the numbers are identical.
 * Otherwise the original line stays and the issue remains in the report (→ NEEDS_REVIEW). Returns { value, log }.
 */
export async function correctLanguage(config, value, { chatFn, signal, maxCalls = 6, onLineChanged = (l) => l } = {}) {
  const hing = config.language.id === 'hinglish', field = hing ? 'say' : 'text', log = [];
  const lines = value.script.lines.map((l) => ({ ...l }));
  const digits = (t) => (String(t).match(/\d+(?:\.\d+)?/g) || []).sort().join();
  let calls = 0;
  for (let i = 0; i < lines.length; i++) {
    const orig = String(lines[i][field] || lines[i].text);
    const errs = languageIssues(config, { lines: [lines[i]] }).filter((x) => x.severity === 'error');
    if (!errs.length) continue;
    // 1. mechanical
    let t = mechanicalFix(orig, errs);
    let left = languageIssues(config, { lines: [{ ...lines[i], [field]: t, text: hing ? lines[i].text : t }] }).filter((x) => x.severity === 'error');
    const entry = { line: i + 1, original: orig, errors: errs.map((x) => x.detail) };
    if (t !== orig && blocking(meaningDiff(orig, t)).length === 0 && digits(t) === digits(orig)) { entry.mechanical = t; } else t = orig;
    // 2. model correction for what is left
    if (left.length && chatFn && calls < maxCalls) {
      calls++;
      const schema = { type: 'object', properties: { line: { type: 'string', maxLength: Math.round(t.length * 1.3) + 10 } }, required: ['line'], additionalProperties: false };
      const sys = [`You fix ONLY the grammar problem named below in one ${config.language.code === 'hi' ? 'Hindi (Devanagari)' : 'English'} narration sentence.`,
        'Change as few words as possible. Keep every word that carries meaning, every name, number, place, quantity, certainty word (शायद, सकता, may) and cause word exactly. Do not add or remove information. Output ONLY JSON.'].join('\n');
      try {
        const { text, truncated } = await chatFn({ messages: [{ role: 'system', content: sys }, { role: 'user', content: `SENTENCE: ${t}\nPROBLEM: ${left.map((x) => x.detail).join('; ')}` }], schema, temperature: 0, maxTokens: Math.round(t.length * 1.4) + 60, signal });
        const c = String(JSON.parse(text)?.line || '').trim();
        const d = meaningDiff(t, c), after = languageIssues(config, { lines: [{ ...lines[i], [field]: c, text: hing ? lines[i].text : c }] }).filter((x) => x.severity === 'error');
        const why = truncated ? 'cut off' : !c ? 'empty' : digits(c) !== digits(t) ? 'numbers changed' : blocking(d).length ? `meaning: ${blocking(d)[0].detail}` : d.dropped.length || d.added.length ? `words changed beyond the fix (dropped: ${d.dropped.join(', ') || '-'}; added: ${d.added.join(', ') || '-'})` : after.length >= left.length ? 'the error is still there' : null;
        entry.model = { answer: c.slice(0, 300), accepted: !why, reason: why };
        if (!why) { t = c; left = after; }
      } catch (e) { if (signal?.aborted) throw e; entry.model = { accepted: false, reason: `no valid answer (${String(e.message).slice(0, 80)})` }; }
    }
    entry.final = t; entry.remaining = left.map((x) => x.detail); entry.changed = t !== orig;
    if (t !== orig) lines[i] = onLineChanged({ ...lines[i], [field]: t, ...(hing ? {} : { text: t }) }, i);
    log.push(entry);
  }
  return { value: { ...value, script: { ...value.script, lines } }, log, calls };
}
