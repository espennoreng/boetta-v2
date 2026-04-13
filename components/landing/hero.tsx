import Link from "next/link";
import { FileUp, ListChecks, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function Hero() {
  return (
    <section className="border-b bg-gradient-to-b from-muted/40 to-background">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 md:grid-cols-2 md:py-28">
        <div className="flex flex-col justify-center gap-6">
          <h1 className="text-4xl font-semibold tracking-tight md:text-6xl">
            Byggesaksvurdering som står seg juridisk
          </h1>
          <p className="text-lg text-muted-foreground md:text-xl">
            Boetta leser byggesøknader, matcher dem mot DIBKs nasjonale
            sjekklister, og gir deg begrunnede vurderinger med henvisninger
            til PBL og SAK10 — slik at du kan fatte vedtak raskere og tryggere.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              size="lg"
              render={
                <a href="mailto:espennoreng@gmail.com?subject=Interessert%20i%20Boetta" />
              }
              nativeButton={false}
            >
              Kom i gang
            </Button>
            <Button
              variant="ghost"
              size="lg"
              render={<Link href="#slik-fungerer-det" />}
              nativeButton={false}
            >
              Se hvordan det fungerer
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Card>
            <CardContent className="flex items-start gap-4 p-5">
              <FileUp className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">byggesoknad.pdf</p>
                <p className="text-xs text-muted-foreground">
                  RS — Enebolig, ett-trinns søknad
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-start gap-4 p-5">
              <ListChecks className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">DIBK-sjekkliste matches</p>
                <p className="text-xs text-muted-foreground">
                  34 av 47 sjekkpunkter dekket
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-start gap-4 p-5">
              <ScrollText className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Vurdering klar</p>
                <p className="text-xs text-muted-foreground">
                  Med henvisninger til PBL § 21-2 og SAK10 § 5-4
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
