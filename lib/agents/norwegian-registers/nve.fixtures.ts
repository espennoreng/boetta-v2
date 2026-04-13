// All responses are GeoJSON FeatureCollections returned by ArcGIS MapServer /query with f=geojson.

// Hit on Flomsoner1/MapServer/17 (1000-years return period)
export const flomsonerHit = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: null,
      properties: { gjentaksinterval: 1000, flomsoneID: 42, objektType: "Flomsone" },
    },
  ],
};

export const emptyCollection = {
  type: "FeatureCollection",
  features: [],
};

// Hit on FlomAktsomhet/MapServer/1
export const aktsomhetHit = {
  type: "FeatureCollection",
  features: [{ type: "Feature", geometry: null, properties: { objektType: "Aktsomhet" } }],
};

// Hit on FlomAktsomhet/MapServer/2 — area IS mapped
export const dekningHit = {
  type: "FeatureCollection",
  features: [{ type: "Feature", geometry: null, properties: { status: "kartlagt" } }],
};

// Skred fixtures (used in Task 5 — included here so Task 5 doesn't have to split fixtures file)
export const kvikkleireHit = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: null, properties: { skredType: 141, objektType: "Aktsomhet" } },
  ],
};

export const steinsprangHit = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: null, properties: { skredtype: "steinsprang", subtypeKode: 3 } },
  ],
};

export const snoskredHit = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", geometry: null, properties: { skredType: 110, sikkerhetsklasse: "S2" } },
  ],
};
