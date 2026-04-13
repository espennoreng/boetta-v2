import type { Metadata } from "next";
import { PlaceholderLayout } from "@/components/landing/placeholder-layout";
import { PlaceholderBanner } from "@/components/landing/placeholder-banner";

export const metadata: Metadata = {
  title: "Personvern — Boetta",
};

export default function PersonvernPage() {
  return (
    <PlaceholderLayout>
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
        Personvernerklæring
      </h1>
      <div className="mt-8">
        <PlaceholderBanner />
      </div>

      <section className="prose prose-neutral dark:prose-invert max-w-none space-y-8 text-sm leading-relaxed">
        <div>
          <h2 className="text-xl font-semibold">Behandlingsansvarlig</h2>
          <p className="text-muted-foreground">
            TODO: navn og kontaktinformasjon på behandlingsansvarlig.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold">
            Hvilke opplysninger vi behandler
          </h2>
          <p className="text-muted-foreground">
            TODO: liste over personopplysninger (navn, e-post, organisasjon,
            innhold i opplastede søknader, m.m.).
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold">Formål og rettslig grunnlag</h2>
          <p className="text-muted-foreground">
            TODO: beskriv formål og hjemmel (databehandleravtale, samtykke,
            berettiget interesse).
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold">Databehandlere</h2>
          <p className="text-muted-foreground">
            Clerk (autentisering), Neon (database, EU-region), Anthropic
            (AI-modell, zero-data-retention). TODO: fullstendig liste med
            lenker til underleverandørers vilkår.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold">Lagringstid</h2>
          <p className="text-muted-foreground">TODO.</p>
        </div>

        <div>
          <h2 className="text-xl font-semibold">Dine rettigheter</h2>
          <p className="text-muted-foreground">
            TODO: innsyn, retting, sletting, klage til Datatilsynet.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold">Kontakt</h2>
          <p className="text-muted-foreground">
            <a
              href="mailto:espennoreng@gmail.com"
              className="underline underline-offset-2 hover:text-foreground"
            >
              espennoreng@gmail.com
            </a>
          </p>
        </div>
      </section>
    </PlaceholderLayout>
  );
}
