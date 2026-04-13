import type { Metadata } from "next";
import { PlaceholderLayout } from "@/components/landing/placeholder-layout";
import { PlaceholderBanner } from "@/components/landing/placeholder-banner";

export const metadata: Metadata = {
  title: "Kontakt — Boetta",
};

export default function KontaktPage() {
  return (
    <PlaceholderLayout>
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
        Kontakt oss
      </h1>
      <div className="mt-8">
        <PlaceholderBanner />
      </div>

      <section className="space-y-6 text-sm leading-relaxed">
        <p>
          <span className="font-semibold">E-post:</span>{" "}
          <a
            href="mailto:espennoreng@gmail.com"
            className="underline underline-offset-2 hover:text-foreground"
          >
            espennoreng@gmail.com
          </a>
        </p>

        <div>
          <h2 className="text-xl font-semibold">For kommuner</h2>
          <p className="mt-2 text-muted-foreground">
            Vi er i tidlig pilot. Send oss en e-post så avtaler vi en demo
            og går gjennom databehandleravtale.
          </p>
        </div>

        <div>
          <h2 className="text-xl font-semibold">For utbyggere og foretak</h2>
          <p className="mt-2 text-muted-foreground">
            Ta kontakt hvis dere vil bruke Boetta til å kvalitetssikre
            søknader før innsending.
          </p>
        </div>

        <p className="text-xs text-muted-foreground">
          TODO: vurder kontaktskjema eller andre kanaler.
        </p>
      </section>
    </PlaceholderLayout>
  );
}
