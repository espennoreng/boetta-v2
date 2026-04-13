import Link from "next/link";
import { Button } from "@/components/ui/button";

const GRAIN_SVG = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.6'/></svg>")`;

export function Hero() {
  return (
    <section className="border-b bg-gradient-to-b from-muted/40 to-background">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 md:grid-cols-[1.1fr_1fr] md:py-28">
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

        <div className="relative aspect-[4/5] overflow-hidden rounded-2xl shadow-xl ring-1 ring-black/5 md:aspect-[3/4]">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-100 via-stone-300 to-stone-800" />
          <div className="absolute inset-0 bg-gradient-to-tr from-amber-900/35 via-transparent to-stone-50/20" />
          {/* Drop a file at public/hero.jpg and uncomment the <img> below to replace the gradient with a real photo. */}
          {/* <img src="/hero.jpg" alt="Saksbehandler ved arbeidspult" className="absolute inset-0 h-full w-full object-cover" /> */}
          <div
            className="pointer-events-none absolute inset-0 opacity-60 mix-blend-overlay"
            style={{ backgroundImage: GRAIN_SVG }}
          />
        </div>
      </div>
    </section>
  );
}
