import type { Metadata } from "next";
import { LandingNav } from "@/components/landing/nav";
import { Hero } from "@/components/landing/hero";
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
      <main className="flex flex-1 flex-col">
        <Hero />
      </main>
      <LandingFooter />
    </>
  );
}
