import type { ReactNode } from "react";
import { LandingNav } from "./nav";
import { LandingFooter } from "./footer";

export function PlaceholderLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <LandingNav />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16 md:py-24">
        {children}
      </main>
      <LandingFooter />
    </div>
  );
}
