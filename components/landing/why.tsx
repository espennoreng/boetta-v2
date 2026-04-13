import { Clock, Scale, GraduationCap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ITEMS = [
  {
    icon: Clock,
    title: "12-ukers fristen",
    body: "Stadig flere søknader, samme bemanning. Boetta kutter gjennomgangstiden fra timer til minutter.",
  },
  {
    icon: Scale,
    title: "Begrunnelseskravet",
    body: "Forvaltningsloven krever at vedtak begrunnes. Boetta siterer lovteksten direkte, slik at vedtaket ditt holder ved klage.",
  },
  {
    icon: GraduationCap,
    title: "Ny på kontoret",
    body: "Nye saksbehandlere kommer raskere i gang. Boetta viser hvilke sjekkpunkter som gjelder for akkurat denne tiltakstypen.",
  },
];

export function Why() {
  return (
    <section id="hvorfor" className="border-b">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <div className="mb-12 max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Hvorfor Boetta
          </h2>
          <p className="mt-3 text-muted-foreground">
            Tre problemer enhver kommunal byggesaksavdeling kjenner igjen —
            og hvordan Boetta løser dem.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {ITEMS.map(({ icon: Icon, title, body }) => (
            <Card key={title}>
              <CardHeader>
                <Icon className="size-6 text-muted-foreground" />
                <CardTitle className="mt-3">{title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
