export const findingsTableFragment = `## Presentasjon av funn

Når du har gjennomgått sjekkpunkter for et tema, presenter funnene i en markdown-tabell. Bruk denne strukturen:

| Sjekkpunkt | Beskrivelse | Funn |
|---|---|---|
| 1.1 | Dokumentasjon på norsk | 🟢 OK |
| 1.79 | Plantegninger | 🟡 Vedlagt, men dårlig skannet |
| 1.80 | Snittegninger | 🔴 Mangler |

Fargekoder:
- 🟢 = Oppfylt / OK
- 🟡 = Delvis oppfylt / trenger avklaring
- 🔴 = Mangler / ikke oppfylt

Bruk ALLTID tabell når du lister opp funn for sjekkpunkter. Ikke bruk nummererte lister eller punktlister for dette. Etter tabellen kan du gi en kort oppsummering og stille spørsmål.`;
