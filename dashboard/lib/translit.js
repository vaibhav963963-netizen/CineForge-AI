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

// the conventional casual spelling of very common words
const COMMON = { 'में': 'mein', 'हैं': 'hain', 'है': 'hai', 'नहीं': 'nahi', 'यहाँ': 'yahan', 'वहाँ': 'wahan', 'क्यों': 'kyun', 'मैं': 'main', 'तो': 'toh', 'ये': 'ye', 'वो': 'wo', 'यह': 'yeh', 'वह': 'woh', 'कि': 'ki', 'और': 'aur', 'क्रिकेट': 'cricket', 'मिशन': 'mission', 'बजट': 'budget', 'आउट': 'out', 'विकेट': 'wicket', 'रॉकेट': 'rocket', 'हीरो': 'hero', 'इसरो': 'ISRO', 'मार्स': 'Mars', 'भारत': 'Bharat' };
export function devanagariToHinglish(text) {
  const s = String(text).split(/(\s+)/).map((w) => {
    if (!/[ऀ-ॿ]/.test(w)) return w;
    const m = w.match(/^([^ऀ-ॿ]*)([ऀ-ॿ]+)([^ऀ-ॿ]*)$/);
    return m && COMMON[m[2]] ? m[1] + COMMON[m[2]] + m[3] : word(w);
  }).join('');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
