import type { Metadata } from "next";
import { PlaceholderLayout } from "@/components/landing/placeholder-layout";
import { PlaceholderBanner } from "@/components/landing/placeholder-banner";

export const metadata: Metadata = {
  title: "Vilkår — Boetta",
};

export default function VilkarPage() {
  return (
    <PlaceholderLayout>
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
        Brukervilkår
      </h1>
      <div className="mt-8">
        <PlaceholderBanner />
      </div>

      <section className="space-y-8 text-sm leading-relaxed">
        <div>
          <h2 className="text-xl font-semibold">Om tjenesten</h2>
          <p className="text-muted-foreground">TODO.</p>
        </div>

        <div>
          <h2 className="text-xl font-semibold">Bruk av tjenesten</h2>
          <p className="text-muted-foreground">TODO.</p>
        </div>

        <div>
          <h2 className="text-xl font-semibold">Ansvarsbegrensning</h2>
          <p className="text-muted-foreground">
            Viktig TODO: Boetta er et beslutningsstøtteverktøy. Endelig
            vedtak treffes av kvalifisert saksbehandler i kommunen.
            TODO: formaliser ordlyd.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold">Immaterielle rettigheter</h2>
          <p className="text-muted-foreground">TODO.</p>
        </div>

        <div>
          <h2 className="text-xl font-semibold">Oppsigelse</h2>
          <p className="text-muted-foreground">TODO.</p>
        </div>

        <div>
          <h2 className="text-xl font-semibold">Gjeldende rett og verneting</h2>
          <p className="text-muted-foreground">
            Norsk rett. TODO: verneting.
          </p>
        </div>
      </section>
    </PlaceholderLayout>
  );
}
