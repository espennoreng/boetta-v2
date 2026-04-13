import { ShieldCheck, KeyRound, Server, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ITEMS = [
  {
    icon: ShieldCheck,
    title: "GDPR og databehandleravtale",
    body: "Vi inngår databehandleravtale med hver kommune. Data behandles i samsvar med personvernforordningen.",
  },
  {
    icon: KeyRound,
    title: "Autentisering med Clerk",
    body: "Pålogging og organisasjonshåndtering via Clerk (SOC 2 Type II-sertifisert). MFA støttes.",
  },
  {
    icon: Server,
    title: "Lagring i EU",
    body: "Neon Postgres i EU-region. Kryptert i ro og i transitt.",
  },
  {
    icon: Lock,
    title: "Kontrollert AI-leverandør",
    body: "Vi bruker Anthropic Claude med zero-data-retention: Anthropic lagrer ikke innholdet i søknadene dine, og bruker det ikke til trening. All trafikk krypteres med TLS.",
  },
];

export function Security() {
  return (
    <section id="sikkerhet" className="border-b">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <div className="mb-12 max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Personvern og sikkerhet
          </h2>
          <p className="mt-3 text-muted-foreground">
            Byggesøknader inneholder personopplysninger. Vi behandler dem
            deretter.
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
