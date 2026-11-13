// Regressions from the Octopus Hinglish audit (data flow: model writes Devanagari voice text → `say`;
// the Roman caption `text` is derived by hinglishCaption; both are saved and served unchanged).
import test from 'node:test';
import assert from 'node:assert/strict';
import { hinglishCaption } from '../dashboard/lib/translit.js';
import { storyProblems, hinglishProblems } from '../dashboard/lib/scriptgen.js';
import { findTopicFacts, reviewClaims } from '../dashboard/lib/factcheck.js';

test('caption: sentence-final words are looked up (the danda used to glue onto the word: "भाई।" → "bhaee.")', () => {
  assert.equal(hinglishCaption('अलग है, भाई।').text, 'Alag hai, bhai.');
  assert.equal(hinglishCaption('ये ऑक्सीजन के लिए फिल्टर हैं।').text, 'Ye oxygen ke liye filter hain.');
  assert.equal(hinglishCaption('ब्रांचियल दिल गिल्स में खून भेजता है।').text, 'Branchial dil gills mein khun bhejta hai.');
});

test('filler forms of address ("…, भाई।" on several lines) are flagged; one natural use is not', () => {
  const S = (...t) => ({ lines: t.map((text) => ({ text })) });
  assert.ok(storyProblems(S('ऑक्टोपस का खून पंप करने का तरीका अलग है, भाई।', 'उसके तीन दिल होते हैं।', 'ये सिस्टम शिकार में मदद करता है, भाई।')).some((p) => /filler/.test(p)));
  assert.ok(storyProblems(S('Octopus ka khoon pump karne ka tarika alag hai, bhaee.', 'Uske teen dil hote hain.', 'Isliye wo tez tair pata hai.')).some((p) => /filler/.test(p)));
  assert.ok(!storyProblems(S('भाई, सोचिए एक जानवर के तीन दिल हों तो क्या होगा?', 'ऑक्टोपस के सच में तीन दिल होते हैं।', 'दो दिल गिल्स के लिए और एक पूरे शरीर के लिए।')).some((p) => /filler/.test(p)));
});

test('Hinglish must be Hinglish: plain Hindi with (almost) no English words is flagged', () => {
  const hindiOnly = { lines: [{ text: 'Uske teen hriday hote hain.', say: 'उसके तीन हृदय होते हैं।', english: [] }, { text: 'Do galphade saaf karte hain.', say: 'दो गलफड़े साफ़ करते हैं।', english: [] }, { text: 'Ek poore sharir ko rakt deta hai.', say: 'एक पूरे शरीर को रक्त देता है।', english: [] }] };
  assert.ok(hinglishProblems(hindiOnly).some((p) => /plain Hindi/.test(p)));
  const hinglish = { lines: [{ text: 'Octopus ke teen heart hote hain.', say: 'ऑक्टोपस के तीन हार्ट होते हैं।', english: ['Octopus', 'heart'] }, { text: 'Do heart gills mein blood bhejte hain.', say: 'दो हार्ट गिल्स में ब्लड भेजते हैं।', english: ['heart', 'gills', 'blood'] }, { text: 'Gills paani se oxygen lete hain.', say: 'गिल्स पानी से ऑक्सीजन लेते हैं।', english: ['gills', 'oxygen'] }] };
  assert.deepEqual(hinglishProblems(hinglish), []);
});

test('facts are checked on the Devanagari voice text: "two hearts" and "gills are oxygen filters" are known errors', () => {
  const f = findTopicFacts('Why do octopuses have three hearts?');
  const lines = [{ text: 'Unke pas do dil hain - branchial aur systemic.', say: 'उनके पास दो दिल हैं - ब्रांचियल और सिस्टमिक।' }, { text: 'Ye oxygen ke liye filter hain.', say: 'ये ऑक्सीजन के लिए फिल्टर हैं।' }, { text: 'Do branchial heart gills mein blood bhejte hain.', say: 'दो ब्रांकियल हार्ट गिल्स में ब्लड भेजते हैं।' }];
  const bad = reviewClaims({ lines }, { topic: 'octopus', topicFacts: f }).claims.filter((c) => c.status === 'contradicted').map((c) => c.line);
  assert.deepEqual([...new Set(bad)].sort(), [1, 2]);   // line 3 ("two branchial hearts") is correct and not flagged
});
test('caption spelling is consistent across lines when English hints are pooled ("oktopas" vs "Octopus")', () => {
  assert.match(hinglishCaption('दिल बंद होने पर ऑक्टोपस तैरना मुश्किल पाता है।', ['octopus', 'heart']).text, /octopus/i);
});
test('the "gills are like filters" analogy is caught in the Devanagari voice text', () => {
  const f = findTopicFacts('Why do octopuses have three hearts?');
  const r = reviewClaims({ lines: [{ text: 'Chhote heart gills ke madhyam se khun dhakelte hain - jaise filters.', say: 'छोटे हार्ट गिल्स के माध्यम से खून धकेलते हैं - जैसे फिल्टर।' }] }, { topic: 'octopus', topicFacts: f });
  assert.ok(r.claims.some((c) => c.status === 'contradicted'));
});
