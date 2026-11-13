// Arjun — Bengaluru Techie & Creator
// 3D design (colours, hair, accessories) and selectable appearances of this character.
// Looks override design fields for one video; the first look is the default.
export const id = "indian_techie";

export const design = {
  "name": "Indian Techie (Rohan)",
  "skin": "#E8A87C",
  "hairColor": "#1A1A1A",
  "hairStyle": "modern",
  "shirt": "#00897B",
  "pants": "#212121",
  "shoes": "#424242",
  "trim": "#80CBC4",
  "accessories": [
    "glasses",
    "headphones"
  ]
};

export const looks = [
  {
    "id": "classic",
    "name": "Teal hoodie"
  },
  {
    "id": "office",
    "name": "Office formal",
    "overrides": {
      "shirt": "#FFFFFF",
      "vest": "#1A237E",
      "pants": "#263238",
      "trim": "#90CAF9",
      "shoes": "#111111",
      "accessories": [
        "glasses"
      ]
    }
  },
  {
    "id": "weekend",
    "name": "Weekend tee",
    "overrides": {
      "shirt": "#FFCA28",
      "vest": "#FFCA28",
      "pants": "#1565C0",
      "trim": "#FFFFFF",
      "shoes": "#ECEFF1",
      "accessories": [
        "glasses"
      ]
    }
  }
];

export default { id, design, looks };
