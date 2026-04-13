import { FileText, ListChecks, BookMarked, History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const FEATURES = [
  {
    icon: FileText,
    title: "PDF-lesing",
    body: "Leser store søknadsbunker direkte. Ingen manuell transkribering.",
  },
  {
    icon: ListChecks,
    title: "DIBKs sjekklister",
    body: "Hele den nasjonale sjekklisten, filtrert på tiltakstype. 130 sjekkpunkter, kun de relevante.",
  },
  {
    icon: BookMarked,
    title: "Lovhenvisninger og sitater",
    body: "Hvert funn er knyttet til konkret lovtekst i PBL eller SAK10 — med sitat.",
  },
  {
    icon: History,
    title: "Revisjonsspor",
    body: "Alle saker og vurderinger lagres per organisasjon. Du ser hvem som åpnet hva, når.",
  },
];

export function Features() {
  return (
    <section id="funksjoner" className="border-b">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <div className="mb-12 max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Funksjoner
          </h2>
          <p className="mt-3 text-muted-foreground">
            Bygget for byggesaksavdelingen — ikke et generelt AI-verktøy.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, body }) => (
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
