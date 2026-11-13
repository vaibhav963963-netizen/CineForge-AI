// Devanagari → Roman "Hinglish" transliteration (the casual spelling Indians type: भारत → bharat, मंगल → mangal,
// कैसे → kaise). Used for Hinglish captions when the script model wrote a line only in Devanagari: the Devanagari stays
// as the "say" form the Hindi voice reads, and the captions get this Roman form. Deterministic, no model needed.
const V = { 'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऑ': 'o', 'ॲ': 'e' };
const M = { 'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o', 'ॅ': 'e' };
const C = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n', 'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n', 'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  'क़': 'q', 'ख़': 'kh', 'ग़': 'gh', 'ज़': 'z', 'ड़': 'r', 'ढ़': 'rh', 'फ़': 'f', 'य़': 'y',
};
const DIGITS = '०१२३४५६७८९';
const VIRAMA = '्', NUKTA = '़', ANUSVARA = 'ं', CHANDRA = 'ँ', VISARGA = 'ः';

// casual spelling of vowel signs (people type "kya", "gali", "diya", not "kyaa", "galee", "diyaa")
const CASUAL = { 'ा': 'a', 'ी': 'i', 'ू': 'u' };
const CASUAL_C = { 'ड़': 'd', 'ढ़': 'dh', 'ष': 'sh' };

function word(w) {
  const ch = [...w.normalize('NFC')];
  // 1 · syllables: { cons, vowel } where vowel is a sign, 'a' (inherent), '' (virama) or null (standalone char)
  const syl = [];
  for (let i = 0; i < ch.length; i++) {
    let c = ch[i];
    if (ch[i + 1] === NUKTA) { c = c + NUKTA; i++; }
    if (C[c] !== undefined) {
      const n = ch[i + 1], cons = CASUAL_C[c] ?? C[c];
      if (n === VIRAMA) { syl.push({ cons, vowel: '' }); i++; }
      else if (M[n] !== undefined) { syl.push({ cons, vowel: CASUAL[n] ?? M[n] }); i++; }
      else syl.push({ cons, vowel: 'a', inherent: true });
      continue;
    }
    if (V[c] !== undefined) { syl.push({ cons: '', vowel: V[c] }); continue; }
    if (c === ANUSVARA || c === CHANDRA) { syl.push({ cons: 'n', vowel: '' }); continue; }
    if (c === VISARGA) { syl.push({ cons: 'h', vowel: '' }); continue; }
    if (c === '।' || c === '॥') { syl.push({ cons: '.', vowel: '' }); continue; }
    const d = DIGITS.indexOf(c);
    syl.push({ cons: d >= 0 ? String(d) : c, vowel: '' });
  }
  // 2 · Hindi schwa deletion: final inherent "a" drops (भारत → bharat); a medial one drops between a vowel-bearing
  //     syllable and a following consonant+vowel (अपना → apna, इसरो → isro, सबसे → sabse)
  const letters = syl.filter((s) => /[a-z]/i.test(s.cons + s.vowel));
  const lastIdx = syl.lastIndexOf(letters[letters.length - 1]);
  if (lastIdx > 0 && syl[lastIdx].inherent) syl[lastIdx].vowel = '';
  for (let k = lastIdx - 1; k >= 1; k--) {   // right to left, as the rule is defined
    const s = syl[k], prev = syl[k - 1], next = syl[k + 1];
    if (s.inherent && prev.vowel && next && next.cons && next.vowel) s.vowel = '';
  }
  return syl.map((s) => s.cons + s.vowel).join('');
}

// the conventional casual spelling of very common Hindi words
const COMMON = { 'में': 'mein', 'हैं': 'hain', 'है': 'hai', 'नहीं': 'nahi', 'यहाँ': 'yahan', 'वहाँ': 'wahan', 'क्यों': 'kyun', 'मैं': 'main', 'तो': 'toh', 'ये': 'ye', 'वो': 'wo', 'यह': 'yeh', 'वह': 'woh', 'कि': 'ki', 'और': 'aur', 'भारत': 'Bharat',
  // common words the letter-by-letter rule spells unnaturally ("ke lie", "bhaee", "huee", "gae")
  'लिए': 'liye', 'लिये': 'liye', 'भाई': 'bhai', 'हुई': 'hui', 'हुए': 'hue', 'गए': 'gaye', 'गई': 'gayi', 'गये': 'gaye', 'कई': 'kai', 'नई': 'nayi', 'आए': 'aaye', 'आई': 'aayi', 'किए': 'kiye', 'दिए': 'diye', 'पाए': 'paaye', 'चाहिए': 'chahiye', 'उन्हें': 'unhe', 'इन्हें': 'inhe', 'उसे': 'use', 'इसे': 'ise', 'क्या': 'kya', 'कैसे': 'kaise', 'ऐसे': 'aise', 'जैसे': 'jaise', 'वैसे': 'waise', 'दोनों': 'dono', 'बीच': 'beech', 'ज़्यादा': 'zyada', 'ज्यादा': 'zyada', 'सबसे': 'sabse', 'असल': 'asal', 'वजह': 'wajah', 'जगह': 'jagah' };
// English loanwords as Indians write them in Devanagari → their English spelling (nukta-free keys; see dekey)
const LOANWORDS = {
  'क्रिकेट': 'cricket', 'मिशन': 'mission', 'बजट': 'budget', 'आउट': 'out', 'विकेट': 'wicket', 'रॉकेट': 'rocket', 'हीरो': 'hero', 'इसरो': 'ISRO', 'मार्स': 'Mars', 'नासा': 'NASA',
  'टीम': 'team', 'मैच': 'match', 'रन': 'run', 'रन्स': 'runs', 'ओवर': 'over', 'बॉलर': 'bowler', 'बैट': 'bat', 'बॉल': 'ball', 'कैप्टन': 'captain', 'स्टेडियम': 'stadium', 'वर्ल्ड': 'world', 'कप': 'cup', 'रिकॉर्ड': 'record',
  'फोन': 'phone', 'मोबाइल': 'mobile', 'इंटरनेट': 'internet', 'यूट्यूब': 'YouTube', 'गूगल': 'Google', 'कंप्यूटर': 'computer', 'टेक्नोलॉजी': 'technology', 'साइंस': 'science', 'साइंटिस्ट': 'scientist', 'साइंटिस्ट्स': 'scientists', 'रिसर्च': 'research', 'डीएनए': 'DNA',
  'सैटेलाइट': 'satellite', 'ऑर्बिट': 'orbit', 'स्पेस': 'space', 'इंजन': 'engine', 'फ्यूल': 'fuel', 'सिग्नल': 'signal', 'कैमरा': 'camera', 'प्लान': 'plan', 'बिलियन': 'billion', 'मिलियन': 'million', 'डॉलर': 'dollar', 'डॉलर्स': 'dollars',
  'लाइफ': 'life', 'स्टोरी': 'story', 'फैक्ट': 'fact', 'ट्रिक': 'trick', 'टेस्ट': 'test', 'न्यूज': 'news', 'सीक्रेट': 'secret', 'मिस्ट्री': 'mystery', 'लेक': 'lake', 'स्केलेटन': 'skeleton', 'ग्लेशियर': 'glacier', 'लाइट': 'light',
  // science / biology / tech words Hinglish speakers say in English
  'फिल्टर': 'filter', 'गिल': 'gill', 'गिल्स': 'gills', 'ऑक्सीजन': 'oxygen', 'ऑक्सिजन': 'oxygen', 'पंप': 'pump', 'हार्ट': 'heart', 'हार्ट्स': 'hearts', 'ब्लड': 'blood', 'सिस्टम': 'system', 'सिस्टमिक': 'systemic', 'ब्रांचियल': 'branchial', 'ब्रैंकियल': 'branchial',
  'कॉपर': 'copper', 'प्रोटीन': 'protein', 'सेल': 'cell', 'सेल्स': 'cells', 'वायरस': 'virus', 'बैक्टीरिया': 'bacteria', 'वैक्सीन': 'vaccine', 'एंटीबॉडी': 'antibody', 'एंटीबॉडीज़': 'antibodies', 'इम्यून': 'immune', 'टाइडल': 'tidal', 'लॉकिंग': 'locking', 'लिब्रेशन': 'libration',
  'मसल': 'muscle', 'मसल्स': 'muscles', 'स्किन': 'skin', 'कलर': 'colour', 'कैमोफ्लाज': 'camouflage', 'क्रोमैटोफोर': 'chromatophore', 'क्रोमैटोफोर्स': 'chromatophores', 'नर्व': 'nerve', 'नर्व्स': 'nerves', 'ब्रेन': 'brain', 'डेटा': 'data', 'नेटवर्क': 'network', 'सर्वर': 'server', 'बैंक': 'bank', 'पेमेंट': 'payment', 'ऐप': 'app',
  'ग्रेविटी': 'Gravity', 'हॉलीवुड': 'Hollywood', 'बॉलीवुड': 'Bollywood', 'टीवी': 'TV', 'ओके': 'OK', 'बॉस': 'boss', 'एआई': 'AI', 'आईपीएल': 'IPL', 'बीसीसीआई': 'BCCI',
};
// frequent native Hindi words: never matched to an English hint (काम "kaam" ≠ "come", कर "kar" ≠ "car")
const HINDI_NATIVE = new Set('काम कम कर करना करते करती किया कहा कहते कुछ कोई कौन कब कल कभी बात बार बस साल सब सच समय सौ लोग लेकिन लिए लगा लगता मगर मन मत माना पर पहले पानी पता फिर तक तब था थी थे दिन दो देश नाम नया बहुत बड़ा बड़ी रहा रही रात राज राजा जब जो जान जगह आज आप अब एक हर हम हाथ ही भी वहां यहां शायद सिर्फ़ सिर्फ गया गई घर मार मारे मौत मिले मिला खोज झील हड्डियां कंकाल'.split(' '));
const dekey = (w) => w.normalize('NFC').replace(/\u093C/g, '');   // फ़ोन and फोन are the same word
const LOAN = Object.fromEntries(Object.entries(LOANWORDS).map(([k, v]) => [dekey(k), v]));

// consonant skeleton of a Roman spelling, so the Devanagari-derived form of an English word ("viket", "kriket",
// "kanpyootar") meets its English spelling ("wicket", "cricket", "computer"): vowels, y and h-aspiration drop,
// sound-alike letters merge (w/v, c/k/q, ph/f, z/j, dge/j, tch/ch), doubled letters collapse
export function skeleton(word) {
  let s = String(word).toLowerCase().replace(/[^a-z]/g, '');
  s = s.replace(/tch/g, 'C').replace(/ch/g, 'C').replace(/dg(?=[eiy])/g, 'j').replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/[cq]/g, 'k')
    .replace(/x/g, 'ks').replace(/z/g, 'j').replace(/sh/g, 's').replace(/([aeiou])w/g, '$1').replace(/w/g, 'v').replace(/h/g, '').replace(/n(?=[pb])/g, 'm')
    .replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1');
  return s;
}
const lev1 = (a, b) => {   // edit distance ≤ 1
  if (a === b) return true; if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, e = 0;
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++e > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } }
  return e + (a.length - i) + (b.length - j) <= 1;
};

/**
 * Word-level, language-aware Hinglish caption from a Devanagari (or mixed) line:
 *  · Latin words the model wrote stay exactly as written (no Devanagari round trip);
 *  · a Devanagari word that is one of the English words the model declared for this line ("english") gets that
 *    English spelling, matched by consonant skeleton (विकेट ↔ wicket);
 *  · a known loanword gets its English spelling (क्रिकेट → cricket);
 *  · everything else is Hindi and is transliterated casually (कैसे → kaise).
 * Returns { text, english: [words kept in English spelling] }.
 */
export function hinglishCaption(text, englishHints = []) {
  const hints = (englishHints || []).map(String).map((h) => h.trim()).filter((h) => /^[A-Za-z][A-Za-z'-]*$/.test(h)).map((h) => ({ h, k: skeleton(h) })).filter((x) => x.k);
  const kept = [];
  const out = String(text).split(/(\s+)/).map((w) => {
    if (!/[ऀ-ॿ]/.test(w)) { if (/[A-Za-z]{2,}/.test(w)) kept.push(w.replace(/[^A-Za-z'-]/g, '')); return w; }
    // the danda (। ॥, U+0964/5) sits inside the Devanagari block but is punctuation: keep it out of the word, or every
    // sentence-final word missed the common-word / loanword tables ("भाई।" → "bhaee.")
    const m = w.match(/^([^ऀ-ॣ०-ॿ]*)([ऀ-ॣ०-ॿ]+)([^ऀ-ॣ०-ॿ]*)$/);
    if (!m) return word(w);
    const [, pre, core, post] = m, dk = dekey(core);
    if (COMMON[core]) return pre + COMMON[core] + post;
    const roman = word(core), key = skeleton(roman);
    const hit = !HINDI_NATIVE.has(core) && key.length >= 2 && (hints.find((x) => x.k === key) || (key.length >= 4 && hints.find((x) => x.k.length >= 4 && x.k[0] === key[0] && lev1(x.k, key))));
    if (hit) { kept.push(hit.h); hints.splice(hints.indexOf(hit), 1); return pre + hit.h + post; }
    if (LOAN[dk]) { kept.push(LOAN[dk]); return pre + LOAN[dk] + post; }
    return pre + roman + post;
  }).join('');
  const roman = out.replace(/\s*[।॥]/g, '.');
  return { text: roman.charAt(0).toUpperCase() + roman.slice(1), english: kept };
}
export function devanagariToHinglish(text, englishHints = []) { return hinglishCaption(text, englishHints).text; }
