// ArcGIS MapServer /query?f=json response shape: { features: [{ attributes, geometry }] }.
// Attributes captured from real calls against Bryggen, Bergen (knr 4601).

export const emptyCollection = {
  features: [],
};

export const lokaliteterHit = {
  features: [
    {
      attributes: {
        navn: "Bryggen",
        vernetype: "Fredet",
        vernelov: "Kulturminneloven",
        verneparagraf: "§ 15",
        linkAskeladden: "https://askeladden.ra.no/lokalitet/45765",
      },
      geometry: null,
    },
  ],
};

export const enkeltminnerHit = {
  features: [
    {
      attributes: {
        navn: "Bryggen — bygning nr. 12",
        vernetype: "Automatisk fredet",
        vernelov: "Kulturminneloven",
        verneparagraf: "§ 4",
        linkAskeladden: "https://askeladden.ra.no/enkeltminne/88201",
      },
      geometry: null,
    },
  ],
};

export const sikringssonerHit = {
  features: [
    {
      attributes: {
        lokalitetID: "45765",
        linkAskeladden: "https://askeladden.ra.no/lokalitet/45765",
      },
      geometry: null,
    },
  ],
};

export const fredeteBygJHit = {
  features: [
    {
      attributes: {
        navn: "Bryggen, Jacobsfjorden",
        vernelov: "Kulturminneloven",
        verneparagraf: "§ 15",
        linkAskeladden: "https://askeladden.ra.no/bygg/12345",
      },
      geometry: null,
    },
  ],
};

export const sefrakBygJHit = {
  features: [
    {
      attributes: {
        hustype: "Bolighus",
        datering: "Før 1850",
        linkAskeladden: "https://askeladden.ra.no/sefrak/99887",
      },
      geometry: null,
    },
  ],
};

export const kulturmiljoerHit = {
  features: [
    {
      attributes: {
        navn: "Bergen historiske havneområde",
        vernetype: "Forskriftsfredet kulturmiljø",
        linkAskeladden: "https://askeladden.ra.no/kulturmiljo/7",
      },
      geometry: null,
    },
  ],
};
