// Trusted science / technology vocabulary for Hindi and Hinglish narration.
// English term → accepted Devanagari forms (the English loanword as Hindi speakers write it, and the standard Hindi
// term where one is in common use). Used to VALIDATE terminology — never to auto-replace words. Topic fact files can
// add their own terms ("terms": { "hi": { … } }); both are merged by termProblems() in scriptgen.js.
// Spellings follow common usage in Hindi science writing (NCERT-style terms where they exist).
export const SCIENCE_TERMS = {
  // physics / earth science
  inertia: ['इनर्शिया', 'जड़त्व'], momentum: ['मोमेंटम', 'संवेग'], velocity: ['वेलोसिटी', 'वेग'], acceleration: ['एक्सेलरेशन', 'त्वरण'],
  gravity: ['ग्रेविटी', 'गुरुत्वाकर्षण', 'गुरुत्व'], rotation: ['रोटेशन', 'घूर्णन', 'घूमना', 'घूमती', 'घूमता'], orbit: ['ऑर्बिट', 'कक्षा', 'परिक्रमा'],
  atmosphere: ['एटमॉस्फियर', 'वायुमंडल', 'वातावरण'], equator: ['इक्वेटर', 'भूमध्य रेखा', 'विषुवत रेखा', 'भूमध्यरेखा'], centrifugal: ['सेंट्रीफ्यूगल', 'अपकेंद्री', 'अपकेन्द्री'],
  centripetal: ['सेंट्रीपीटल', 'अभिकेंद्री', 'अभिकेन्द्री'], friction: ['फ्रिक्शन', 'घर्षण'], energy: ['एनर्जी', 'ऊर्जा'], force: ['फोर्स', 'बल'], pressure: ['प्रेशर', 'दबाव', 'दाब'],
  temperature: ['टेम्परेचर', 'तापमान'], density: ['डेंसिटी', 'घनत्व'], molecule: ['मॉलिक्यूल', 'अणु'], atom: ['एटम', 'परमाणु'], electricity: ['इलेक्ट्रिसिटी', 'बिजली', 'विद्युत'],
  magnetic: ['मैग्नेटिक', 'चुंबकीय'], radiation: ['रेडिएशन', 'विकिरण'], hydrogen: ['हाइड्रोजन'], oxygen: ['ऑक्सीजन', 'ऑक्सिजन'], carbon: ['कार्बन'], nitrogen: ['नाइट्रोजन'],
  earthquake: ['भूकंप', 'अर्थक्वेक'], tsunami: ['सुनामी'], cyclone: ['साइक्लोन', 'चक्रवात'], monsoon: ['मानसून'], climate: ['क्लाइमेट', 'जलवायु'],
  // space
  satellite: ['सैटेलाइट', 'उपग्रह'], spacecraft: ['स्पेसक्राफ्ट', 'अंतरिक्ष यान', 'अंतरिक्षयान'], planet: ['प्लैनेट', 'ग्रह'], galaxy: ['गैलेक्सी', 'आकाशगंगा'],
  libration: ['लिब्रेशन'], 'tidal locking': ['टाइडल लॉकिंग', 'ज्वारीय बंधन'], tidal: ['टाइडल', 'ज्वारीय'], telescope: ['टेलीस्कोप', 'दूरबीन'], rocket: ['रॉकेट'],
  // biology / medicine
  hemocyanin: ['हीमोसायनिन', 'हीमोसाइनिन'], hemoglobin: ['हीमोग्लोबिन'], gills: ['गिल्स', 'गलफड़े', 'गलफड़ों'], chromatophore: ['क्रोमैटोफोर', 'क्रोमैटोफोर्स'],
  vaccine: ['वैक्सीन', 'टीका', 'टीके'], antibody: ['एंटीबॉडी', 'एंटीबॉडीज़', 'एंटीबॉडीज'], antibodies: ['एंटीबॉडी', 'एंटीबॉडीज़', 'एंटीबॉडीज'], immune: ['इम्यून', 'प्रतिरक्षा'],
  bacteria: ['बैक्टीरिया', 'जीवाणु'], virus: ['वायरस', 'विषाणु'], cell: ['सेल', 'कोशिका'], cells: ['सेल्स', 'कोशिकाएं', 'कोशिकाएँ', 'कोशिकाओं'], protein: ['प्रोटीन'],
  photosynthesis: ['फोटोसिंथेसिस', 'प्रकाश संश्लेषण'], dna: ['डीएनए'], neuron: ['न्यूरॉन'], branchial: ['ब्रांकियल', 'ब्रांचियल', 'ब्रैंकियल'], systemic: ['सिस्टमिक', 'सिस्टेमिक'],
  // technology
  algorithm: ['एल्गोरिदम'], server: ['सर्वर'], internet: ['इंटरनेट'], network: ['नेटवर्क'], encryption: ['एन्क्रिप्शन'], payment: ['पेमेंट', 'भुगतान'], software: ['सॉफ्टवेयर'],
};
