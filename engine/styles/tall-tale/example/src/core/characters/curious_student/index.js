// Aarav — Curious Explorer
// 3D design (colours, hair, accessories) and selectable appearances of this character.
// Looks override design fields for one video; the first look is the default.
export const id = "curious_student";

export const design = {
  "name": "Curious Student (Aarav)",
  "skin": "#F7C59F",
  "hairColor": "#2B2B2B",
  "hairStyle": "curly",
  "shirt": "#FB8C00",
  "pants": "#37474F",
  "shoes": "#E0E0E0",
  "trim": "#00ACC1",
  "accessories": [
    "backpack"
  ]
};

export const looks = [
  {
    "id": "classic",
    "name": "Orange tee & backpack"
  },
  {
    "id": "uniform",
    "name": "School uniform",
    "overrides": {
      "shirt": "#FFFFFF",
      "vest": "#0D47A1",
      "pants": "#1A237E",
      "trim": "#C62828",
      "shoes": "#111111"
    }
  },
  {
    "id": "sports",
    "name": "Sports day",
    "overrides": {
      "shirt": "#43A047",
      "vest": "#43A047",
      "pants": "#FFFFFF",
      "trim": "#FFEB3B",
      "shoes": "#FFFFFF"
    }
  },
  {
    "id": "winter",
    "name": "Winter sweater",
    "overrides": {
      "shirt": "#6D4C41",
      "vest": "#AD1457",
      "pants": "#37474F",
      "trim": "#FFCC80"
    }
  }
];

export default { id, design, looks };
