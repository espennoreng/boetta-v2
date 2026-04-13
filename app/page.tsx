import type { Metadata } from "next";
import { LandingNav } from "@/components/landing/nav";
import { Hero } from "@/components/landing/hero";
import { Why } from "@/components/landing/why";
import { How } from "@/components/landing/how";
import { Features } from "@/components/landing/features";
import { Legal } from "@/components/landing/legal";
import { Security } from "@/components/landing/security";
import { Audience } from "@/components/landing/audience";
import { CTA } from "@/components/landing/cta";
import { LandingFooter } from "@/components/landing/footer";

export const metadata: Metadata = {
  title: "Boetta — Byggesaksvurdering for norske kommuner",
  description:
    "Boetta leser byggesøknader, matcher dem mot DIBKs nasjonale sjekklister, og gir deg begrunnede vurderinger med henvisninger til PBL og SAK10.",
};

export default function LandingPage() {
  return (
    <>
      <LandingNav />
      <main>
        <Hero />
        <Why />
        <How />
        <Features />
        <Legal />
        <Security />
        <Audience />
        <CTA />
      </main>
      <LandingFooter />
    </>
  );
}
