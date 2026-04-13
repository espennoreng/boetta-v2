// Captured from GET https://ws.geonorge.no/adresser/v1/sok?sok=Karl+Johans+gate+1&utkoordsys=25833&treffPerSide=5
export const adresserSokResponse: {
  metadata: { totaltAntallTreff: number; treffPerSide: number; side: number; viserFra: number; viserTil: number };
  adresser: Array<{
    adressenavn: string;
    adressetekst: string;
    kommunenummer: string;
    kommunenavn: string;
    postnummer: string;
    poststed: string;
    gardsnummer: number;
    bruksnummer: number;
    festenummer: number;
    objtype: "Vegadresse" | "Matrikkeladresse";
    representasjonspunkt: { epsg: string; nord: number; ost: number };
  }>;
} = {
  metadata: { totaltAntallTreff: 2, treffPerSide: 5, side: 0, viserFra: 0, viserTil: 1 },
  adresser: [
    {
      adressenavn: "Karl Johans gate",
      adressetekst: "Karl Johans gate 1",
      kommunenummer: "0301",
      kommunenavn: "Oslo",
      postnummer: "0154",
      poststed: "OSLO",
      gardsnummer: 207,
      bruksnummer: 80,
      festenummer: 0,
      objtype: "Vegadresse",
      representasjonspunkt: { epsg: "EPSG:25833", nord: 6643212.8, ost: 597345.2 },
    },
    {
      adressenavn: "Karl Johans gate",
      adressetekst: "Karl Johans gate 1B",
      kommunenummer: "0301",
      kommunenavn: "Oslo",
      postnummer: "0154",
      poststed: "OSLO",
      gardsnummer: 207,
      bruksnummer: 81,
      festenummer: 0,
      objtype: "Vegadresse",
      representasjonspunkt: { epsg: "EPSG:25833", nord: 6643220.0, ost: 597350.0 },
    },
  ],
};

// Captured from GET https://ws.geonorge.no/eiendom/v1/geokoding?kommunenummer=0301&gardsnummer=207&bruksnummer=80&utkoordsys=25833
export const eiendomGeokodingResponse: {
  type: "FeatureCollection";
  features: Array<{
    type: string;
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: {
      kommunenummer: string;
      gardsnummer: number;
      bruksnummer: number;
      festenummer: number;
      seksjonsnummer: number;
      matrikkelnummertekst: string;
      objekttype: string;
      lokalid: string;
    };
  }>;
} = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [597345.2, 6643212.8] },
      properties: {
        kommunenummer: "0301",
        gardsnummer: 207,
        bruksnummer: 80,
        festenummer: 0,
        seksjonsnummer: 0,
        matrikkelnummertekst: "207/80",
        objekttype: "TeigMedFlerePunkter",
        lokalid: "abc-123",
      },
    },
  ],
};
