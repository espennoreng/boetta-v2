import { ScrollText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function Legal() {
  return (
    <section id="lovverk" className="border-b bg-muted/30">
      <div className="mx-auto max-w-3xl px-6 py-20 md:py-28">
        <div className="mb-8 flex items-center gap-3">
          <ScrollText className="size-6 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">
            Lovverk og sitering
          </span>
        </div>
        <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
          Laget for norsk forvaltningsrett
        </h2>
        <p className="mt-4 text-muted-foreground">
          Boetta bruker DIBKs offisielle nasjonale sjekklister som kilde.
          Hvert sjekkpunkt er knyttet til riktig lovhjemmel — plan- og
          bygningsloven, SAK10, TEK17. Når Boetta konkluderer, ser du
          nøyaktig hvilken paragraf og hvilket sjekkpunkt vurderingen
          bygger på.
        </p>
        <Card className="mt-8 border-l-4 border-l-primary">
          <CardContent className="p-6">
            <p className="text-base italic">
              "Søknaden mangler dokumentasjon på ansvarlig søkers
              kvalifikasjoner, jf. SAK10 § 5-4 første ledd."
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              — eksempel på generert vurdering
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
