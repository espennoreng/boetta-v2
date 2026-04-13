import Link from "next/link";
import { Button } from "@/components/ui/button";

export function CTA() {
  return (
    <section id="kontakt" className="bg-muted/60">
      <div className="mx-auto max-w-3xl px-6 py-20 text-center md:py-28">
        <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
          Klar til å prøve Boetta?
        </h2>
        <p className="mt-4 text-muted-foreground">
          Vi er i tidlig pilot med utvalgte kommuner. Ta kontakt for et
          tilbud eller for å avtale en demo.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button
            size="lg"
            render={
              <a href="mailto:espennoreng@gmail.com?subject=Interessert%20i%20Boetta" />
            }
            nativeButton={false}
          >
            Kontakt oss
          </Button>
          <Button
            variant="ghost"
            size="lg"
            render={<Link href="/sign-in" />}
            nativeButton={false}
          >
            Logg inn
          </Button>
        </div>
      </div>
    </section>
  );
}
