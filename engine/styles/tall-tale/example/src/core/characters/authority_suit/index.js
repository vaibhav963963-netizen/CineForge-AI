// Dr. Vikram — Council Director / Executive
// 3D design (colours, hair, accessories) and selectable appearances of this character.
// Looks override design fields for one video; the first look is the default.
export const id = "authority_suit";

export const design = {
  "name": "Authority Figure (Leader)",
  "skin": "#F0BA95",
  "hairColor": "#37474F",
  "hairStyle": "side_part",
  "shirt": "#ECEFF1",
  "vest": "#263238",
  "pants": "#263238",
  "shoes": "#111111",
  "trim": "#D32F2F",
  "accessories": [
    "tie"
  ]
};

export const looks = [
  {
    "id": "classic",
    "name": "Charcoal suit"
  },
  {
    "id": "navy",
    "name": "Navy suit",
    "overrides": {
      "vest": "#0D1B3E",
      "pants": "#0D1B3E",
      "trim": "#FFB300"
    }
  },
  {
    "id": "lab",
    "name": "Lab coat",
    "overrides": {
      "shirt": "#B3E5FC",
      "vest": "#FAFAFA",
      "pants": "#37474F",
      "trim": "#1565C0"
    }
  },
  {
    "id": "bandhgala",
    "name": "Bandhgala",
    "overrides": {
      "shirt": "#FFF8E1",
      "vest": "#3E2723",
      "pants": "#3E2723",
      "trim": "#FFD700"
    }
  }
];

export default { id, design, looks };
