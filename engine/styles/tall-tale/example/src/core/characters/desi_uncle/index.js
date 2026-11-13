// Sharma Ji — Desi Elder & Balcony Watcher
// 3D design (colours, hair, accessories) and selectable appearances of this character.
// Looks override design fields for one video; the first look is the default.
export const id = "desi_uncle";

export const design = {
  "name": "Desi Uncle (Sharma Ji)",
  "skin": "#DE9B72",
  "hairColor": "#424242",
  "hairStyle": "side_part",
  "shirt": "#FFF8E1",
  "vest": "#C62828",
  "pants": "#F5F5F5",
  "shoes": "#5D4037",
  "trim": "#FFB300",
  "accessories": [
    "mustache",
    "glasses"
  ]
};

export const looks = [
  {
    "id": "classic",
    "name": "Kurta & Nehru jacket"
  },
  {
    "id": "morning",
    "name": "Morning walk",
    "overrides": {
      "shirt": "#ECEFF1",
      "vest": "#1565C0",
      "pants": "#E0E0E0",
      "shoes": "#FFFFFF",
      "trim": "#90CAF9"
    }
  },
  {
    "id": "festive",
    "name": "Festive silk",
    "overrides": {
      "shirt": "#FFE082",
      "vest": "#4A148C",
      "pants": "#FFF8E1",
      "trim": "#FFD700"
    }
  },
  {
    "id": "office",
    "name": "Office shirt",
    "overrides": {
      "shirt": "#B3E5FC",
      "vest": "#B3E5FC",
      "pants": "#37474F",
      "trim": "#0277BD",
      "shoes": "#212121"
    }
  }
];

export default { id, design, looks };
