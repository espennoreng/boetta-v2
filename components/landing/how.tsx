import { Upload, ListChecks, ScrollText } from "lucide-react";

const STEPS = [
  {
    number: "01",
    icon: Upload,
    title: "Last opp søknad",
    body: "Dra inn PDF-en. Boetta identifiserer søknadstype (RS, ET, IG, FA, ES, MB, NV, TA) og tiltakstype automatisk.",
  },
  {
    number: "02",
    icon: ListChecks,
    title: "Sjekkliste matches",
    body: "Riktig DIBK-sjekkliste hentes. Boetta går gjennom sjekkpunktene og markerer hva som er dekket og hva som mangler.",
  },
  {
    number: "03",
    icon: ScrollText,
    title: "Begrunnet vurdering",
    body: "Du får en vurdering med lovhenvisninger (PBL § 21-2, SAK10 § 5-4) og kildesitater — klar til å lime inn i vedtaket.",
  },
];

export function How() {
  return (
    <section id="slik-fungerer-det" className="border-b bg-muted/30">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <div className="mb-12 max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Slik fungerer det
          </h2>
          <p className="mt-3 text-muted-foreground">
            Fra innkommet søknad til begrunnet vurdering i tre steg.
          </p>
        </div>
        <div className="grid gap-8 md:grid-cols-3 md:gap-10">
          {STEPS.map(({ number, icon: Icon, title, body }) => (
            <div key={number} className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm text-muted-foreground">
                  {number}
                </span>
                <span className="h-px flex-1 bg-border" />
                <Icon className="size-5 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold">{title}</h3>
              <p className="text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
