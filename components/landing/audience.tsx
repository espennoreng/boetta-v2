import { Landmark, Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ITEMS = [
  {
    icon: Landmark,
    title: "Kommuner",
    body: "For saksbehandlere i bygg- og reguleringsavdelingen. Hele teamet får tilgang, med deling av saker internt.",
  },
  {
    icon: Building2,
    title: "Ansvarlig søker og foretak",
    body: "For utbyggere og arkitektkontor som vil kvalitetssikre søknaden før den sendes inn.",
  },
];

export function Audience() {
  return (
    <section id="for-hvem" className="border-b bg-muted/30">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <div className="mb-12 max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
            For kommuner og foretak
          </h2>
          <p className="mt-3 text-muted-foreground">
            Samme sjekklister — to bruksmønstre.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
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
