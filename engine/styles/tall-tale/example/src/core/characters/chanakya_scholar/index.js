// Acharya Chanakya — Ancient Mastermind
// 3D design (colours, hair, accessories) and selectable appearances of this character.
// Looks override design fields for one video; the first look is the default.
export const id = "chanakya_scholar";

export const design = {
  "name": "Ancient Scholar (Chanakya)",
  "skin": "#EAA97B",
  "hairColor": "#212121",
  "hairStyle": "bun",
  "shirt": "#FFF3E0",
  "vest": "#E65100",
  "pants": "#FFE0B2",
  "shoes": "#8D6E63",
  "trim": "#FFB74D",
  "accessories": [
    "scarf"
  ]
};

export const looks = [
  {
    "id": "classic",
    "name": "Ivory & saffron"
  },
  {
    "id": "royal",
    "name": "Royal court",
    "overrides": {
      "shirt": "#FFF8E1",
      "vest": "#B71C1C",
      "pants": "#FFE0B2",
      "trim": "#FFD700"
    }
  },
  {
    "id": "ascetic",
    "name": "Ascetic saffron",
    "overrides": {
      "shirt": "#EF6C00",
      "vest": "#E65100",
      "pants": "#FFB74D",
      "trim": "#FFE0B2"
    }
  }
];

export default { id, design, looks };
