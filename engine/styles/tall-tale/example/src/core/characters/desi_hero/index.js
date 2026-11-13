// Bunty — Desi Street Hero
// 3D design (colours, hair, accessories) and selectable appearances of this character.
// Looks override design fields for one video; the first look is the default.
export const id = "desi_hero";

export const design = {
  "name": "Desi Hero (Bunty)",
  "skin": "#F2B98E",
  "hairColor": "#1E1E1E",
  "hairStyle": "modern",
  "shirt": "#1E88E5",
  "vest": "#0D47A1",
  "pants": "#263238",
  "shoes": "#FFFFFF",
  "trim": "#FFD54F",
  "accessories": [
    "cap"
  ]
};

export const looks = [
  {
    "id": "classic",
    "name": "Classic blue jersey"
  },
  {
    "id": "whites",
    "name": "Cricket whites",
    "overrides": {
      "shirt": "#F5F5F5",
      "vest": "#F5F5F5",
      "pants": "#EEEEEE",
      "trim": "#1E88E5",
      "shoes": "#FFFFFF"
    }
  },
  {
    "id": "street",
    "name": "Street casual",
    "overrides": {
      "shirt": "#E53935",
      "vest": "#212121",
      "pants": "#37474F",
      "trim": "#FFFFFF",
      "accessories": []
    }
  },
  {
    "id": "festive",
    "name": "Festive kurta",
    "overrides": {
      "shirt": "#FFB300",
      "vest": "#6A1B9A",
      "pants": "#FFF8E1",
      "trim": "#FFD54F",
      "shoes": "#8D6E63",
      "accessories": []
    }
  }
];

export default { id, design, looks };
