# Landing Page + `/agent` Routing Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the existing chat app from `/` to `/agent`, add a public Norwegian-language landing page at `/` aimed at kommuner, and add placeholder `/personvern`, `/vilkar`, `/kontakt` pages with a prominent "replace before launch" banner.

**Architecture:** Single-page landing at `app/page.tsx` composed of section components in `components/landing/`. Three auxiliary placeholder pages share a common layout. Middleware (`proxy.ts`) is widened to treat `/`, `/personvern`, `/vilkar`, `/kontakt` as public routes. All redirect targets that previously pointed to `/` (meaning "the app") are updated to `/agent`.

**Tech Stack:** Next.js 16 (App Router, Node runtime), React 19, Tailwind CSS v4, shadcn/ui (button, card, alert, separator already installed), lucide-react icons, Clerk auth, Inter font (already loaded).

**Intermediate-state note:** After Task 1 moves the old `app/page.tsx` to `app/agent/page.tsx`, the path `/` will 404 until Task 12 creates the new landing page. This is intentional — work the plan end-to-end on one branch, then merge. Do not deploy mid-plan.

**Spec:** `docs/superpowers/specs/2026-04-13-landing-page-design.md`

---

## File Structure

**Moved:**
- `app/page.tsx` → `app/agent/page.tsx`
- `app/[sessionId]/page.tsx` → `app/agent/[sessionId]/page.tsx`

**New (landing sections — `components/landing/`):**
- `nav.tsx` — sticky top nav (client component for mobile menu)
- `hero.tsx` — hero section with CTAs
- `why.tsx` — "Hvorfor Boetta" three cards
- `how.tsx` — "Slik fungerer det" three steps
- `features.tsx` — "Funksjoner" 2×2 card grid
- `legal.tsx` — "Lovverk og sitering" highlight + example
- `security.tsx` — "Personvern og sikkerhet" 2×2 card grid
- `audience.tsx` — "For kommuner og foretak" two cards
- `cta.tsx` — "Kom i gang" band
- `footer.tsx` — minimal footer

**New (placeholder infrastructure):**
- `components/landing/placeholder-banner.tsx` — shared amber "replace before launch" banner
- `components/landing/placeholder-layout.tsx` — layout wrapper reusing nav + footer

**New (pages):**
- `app/page.tsx` — composes the landing sections (server component)
- `app/personvern/page.tsx` — placeholder personvernerklæring
- `app/vilkar/page.tsx` — placeholder brukervilkår
- `app/kontakt/page.tsx` — placeholder kontakt

**Modified:**
- `proxy.ts` — widen public routes
- `app/layout.tsx` — update `afterSelectOrganizationUrl`
- `app/onboarding/page.tsx` — redirect to `/agent`
- `app/pending/page.tsx` — redirect to `/agent`
- `app/admin/layout.tsx` — redirect to `/agent`
- `app/agent/[sessionId]/page.tsx` (after move) — fallback link → `/agent`
- `.env.local.example` — `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/agent`

---

## Task 1: Move chat app routes under `/agent`

**Files:**
- Move: `app/page.tsx` → `app/agent/page.tsx`
- Move: `app/[sessionId]/page.tsx` → `app/agent/[sessionId]/page.tsx`
- Modify: `app/agent/[sessionId]/page.tsx` (update fallback link)

- [ ] **Step 1: Create target directories and move files**

```bash
mkdir -p app/agent
git mv app/page.tsx app/agent/page.tsx
git mv "app/[sessionId]" "app/agent/[sessionId]"
```

- [ ] **Step 2: Update the fallback href in the session page**

In `app/agent/[sessionId]/page.tsx`, change the "Start a new conversation" link from `/` to `/agent`.

Find:
```tsx
<a href="/" className="text-sm underline">
  Start a new conversation
</a>
```

Replace with:
```tsx
<a href="/agent" className="text-sm underline">
  Start a new conversation
</a>
```

- [ ] **Step 3: Verify TypeScript still compiles**

Run: `bunx tsc --noEmit`
Expected: No errors (or only pre-existing errors unrelated to these files).

- [ ] **Step 4: Verify existing tests still pass**

Run: `bun test`
Expected: All tests in `lib/audit.test.ts` and `lib/auth.test.ts` pass.

- [ ] **Step 5: Commit**

```bash
git add app/agent
git commit -m "refactor(routing): move chat app under /agent prefix"
```

---

## Task 2: Update middleware and all redirect targets

**Files:**
- Modify: `proxy.ts` — widen public routes
- Modify: `app/layout.tsx` — `afterSelectOrganizationUrl`
- Modify: `app/onboarding/page.tsx` — redirect target
- Modify: `app/pending/page.tsx` — redirect target
- Modify: `app/admin/layout.tsx` — redirect target
- Modify: `.env.local.example` — `AFTER_SIGN_IN_URL`

- [ ] **Step 1: Widen public routes in `proxy.ts`**

Find:
```ts
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
]);
```

Replace with:
```ts
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/personvern(.*)",
  "/vilkar(.*)",
  "/kontakt(.*)",
]);
```

Note: `createRouteMatcher(["/"])` matches only the exact `/` path, not any other route. Everything under `/agent/*` still flows through auth + entitlement checks.

- [ ] **Step 2: Update `afterSelectOrganizationUrl` in `app/layout.tsx`**

Find:
```tsx
<OrganizationSwitcher
  hidePersonal
  afterSelectOrganizationUrl="/"
  afterCreateOrganizationUrl="/pending"
/>
```

Replace with:
```tsx
<OrganizationSwitcher
  hidePersonal
  afterSelectOrganizationUrl="/agent"
  afterCreateOrganizationUrl="/pending"
/>
```

(`afterCreateOrganizationUrl` stays `/pending` — new orgs still need super-admin approval.)

- [ ] **Step 3: Update redirect in `app/onboarding/page.tsx`**

Find:
```ts
if (orgId) redirect("/");
```

Replace with:
```ts
if (orgId) redirect("/agent");
```

- [ ] **Step 4: Update redirect in `app/pending/page.tsx`**

Find:
```ts
if (status === "active") redirect("/");
```

Replace with:
```ts
if (status === "active") redirect("/agent");
```

- [ ] **Step 5: Update redirect in `app/admin/layout.tsx`**

Find:
```ts
redirect("/");
```

Replace with:
```ts
redirect("/agent");
```

- [ ] **Step 6: Update `.env.local.example`**

Find:
```
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/
```

Replace with:
```
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/agent
```

Leave `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/onboarding` unchanged.

- [ ] **Step 7: Update the running environment**

Manually update `.env.local` to set `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/agent`. Restart the dev server if it's running so Next.js picks up the new env value.

```bash
# In a separate terminal, or if dev is not running:
bun dev
```

- [ ] **Step 8: Verify TypeScript still compiles**

Run: `bunx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 9: Verify existing tests still pass**

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 10: Commit**

```bash
git add proxy.ts app/layout.tsx app/onboarding/page.tsx app/pending/page.tsx app/admin/layout.tsx .env.local.example
git commit -m "refactor(routing): update redirect targets for /agent prefix and widen public routes"
```

---

## Task 3: Scaffold shared landing components (nav + footer + placeholder banner/layout)

**Files:**
- Create: `components/landing/nav.tsx`
- Create: `components/landing/footer.tsx`
- Create: `components/landing/placeholder-banner.tsx`
- Create: `components/landing/placeholder-layout.tsx`

- [ ] **Step 1: Create `components/landing/nav.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ANCHORS = [
  { href: "/#hvorfor", label: "Hvorfor" },
  { href: "/#slik-fungerer-det", label: "Slik fungerer det" },
  { href: "/#sikkerhet", label: "Sikkerhet" },
  { href: "/#kontakt", label: "Kontakt" },
];

export function LandingNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link
          href="/"
          className="font-sans text-xl font-semibold tracking-tight"
        >
          Boetta
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {ANCHORS.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {a.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <Button
            variant="ghost"
            size="sm"
            render={<Link href="/sign-in" />}
            nativeButton={false}
          >
            Logg inn
          </Button>
          <Button
            size="sm"
            render={
              <a href="mailto:espennoreng@gmail.com?subject=Interessert%20i%20Boetta" />
            }
            nativeButton={false}
          >
            Kom i gang
          </Button>
        </div>

        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md p-2 md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      <div
        className={cn(
          "border-t md:hidden",
          open ? "block" : "hidden",
        )}
      >
        <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-6 py-4">
          {ANCHORS.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              onClick={() => setOpen(false)}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {a.label}
            </Link>
          ))}
          <div className="mt-2 flex flex-col gap-2 border-t pt-4">
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              render={<Link href="/sign-in" />}
              nativeButton={false}
            >
              Logg inn
            </Button>
            <Button
              size="sm"
              render={
                <a href="mailto:espennoreng@gmail.com?subject=Interessert%20i%20Boetta" />
              }
              nativeButton={false}
            >
              Kom i gang
            </Button>
          </div>
        </nav>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Create `components/landing/footer.tsx`**

```tsx
import Link from "next/link";

export function LandingFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-6 py-10 text-sm text-muted-foreground md:flex-row md:items-center">
        <p>© 2026 Boetta</p>
        <nav className="flex gap-6">
          <Link href="/personvern" className="hover:text-foreground">
            Personvern
          </Link>
          <Link href="/vilkar" className="hover:text-foreground">
            Vilkår
          </Link>
          <Link href="/kontakt" className="hover:text-foreground">
            Kontakt
          </Link>
        </nav>
      </div>
    </footer>
  );
}
```

- [ ] **Step 3: Create `components/landing/placeholder-banner.tsx`**

```tsx
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function PlaceholderBanner() {
  return (
    <Alert className="mb-10 border-amber-500/50 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400">
      <AlertTriangle />
      <AlertTitle>Innholdet må erstattes før lansering</AlertTitle>
      <AlertDescription>
        Denne siden er en plassholder generert sammen med landingssiden.
        Erstatt teksten under med endelig juridisk innhold før produksjon.
      </AlertDescription>
    </Alert>
  );
}
```

- [ ] **Step 4: Create `components/landing/placeholder-layout.tsx`**

```tsx
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
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add components/landing/nav.tsx components/landing/footer.tsx components/landing/placeholder-banner.tsx components/landing/placeholder-layout.tsx
git commit -m "feat(landing): add nav, footer, and placeholder scaffolding"
```

---

## Task 4: Build Hero section

**Files:**
- Create: `components/landing/hero.tsx`

- [ ] **Step 1: Create `components/landing/hero.tsx`**

```tsx
import Link from "next/link";
import { FileUp, ListChecks, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function Hero() {
  return (
    <section className="border-b bg-gradient-to-b from-muted/40 to-background">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 md:grid-cols-2 md:py-28">
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

        <div className="flex flex-col gap-3">
          <Card>
            <CardContent className="flex items-start gap-4 p-5">
              <FileUp className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">byggesoknad.pdf</p>
                <p className="text-xs text-muted-foreground">
                  RS — Enebolig, ett-trinns søknad
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-start gap-4 p-5">
              <ListChecks className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">DIBK-sjekkliste matches</p>
                <p className="text-xs text-muted-foreground">
                  34 av 47 sjekkpunkter dekket
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-start gap-4 p-5">
              <ScrollText className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Vurdering klar</p>
                <p className="text-xs text-muted-foreground">
                  Med henvisninger til PBL § 21-2 og SAK10 § 5-4
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add components/landing/hero.tsx
git commit -m "feat(landing): add hero section"
```

---

## Task 5: Build Hvorfor Boetta section

**Files:**
- Create: `components/landing/why.tsx`

- [ ] **Step 1: Create `components/landing/why.tsx`**

```tsx
import { Clock, Scale, GraduationCap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ITEMS = [
  {
    icon: Clock,
    title: "12-ukers fristen",
    body: "Stadig flere søknader, samme bemanning. Boetta kutter gjennomgangstiden fra timer til minutter.",
  },
  {
    icon: Scale,
    title: "Begrunnelseskravet",
    body: "Forvaltningsloven krever at vedtak begrunnes. Boetta siterer lovteksten direkte, slik at vedtaket ditt holder ved klage.",
  },
  {
    icon: GraduationCap,
    title: "Ny på kontoret",
    body: "Nye saksbehandlere kommer raskere i gang. Boetta viser hvilke sjekkpunkter som gjelder for akkurat denne tiltakstypen.",
  },
];

export function Why() {
  return (
    <section id="hvorfor" className="border-b">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <div className="mb-12 max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Hvorfor Boetta
          </h2>
          <p className="mt-3 text-muted-foreground">
            Tre problemer enhver kommunal byggesaksavdeling kjenner igjen —
            og hvordan Boetta løser dem.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add components/landing/why.tsx
git commit -m "feat(landing): add 'Hvorfor Boetta' section"
```

---

## Task 6: Build Slik fungerer det section

**Files:**
- Create: `components/landing/how.tsx`

- [ ] **Step 1: Create `components/landing/how.tsx`**

```tsx
import { Upload, ListChecks, ScrollText } from "lucide-react";

const STEPS = [
  {
    number: "01",
    icon: Upload,
    title: "Last opp søknad",
    body: "Dra inn PDF-en. Boetta identifiserer søknadstype (RS, ET, IG, FA, ES, MB, NV, TA) og tiltakstype automatisk.",
  },
  {
    number: "02",
    icon: ListChecks,
    title: "Sjekkliste matches",
    body: "Riktig DIBK-sjekkliste hentes. Boetta går gjennom sjekkpunktene og markerer hva som er dekket og hva som mangler.",
  },
  {
    number: "03",
    icon: ScrollText,
    title: "Begrunnet vurdering",
    body: "Du får en vurdering med lovhenvisninger (PBL § 21-2, SAK10 § 5-4) og kildesitater — klar til å lime inn i vedtaket.",
  },
];

export function How() {
  return (
    <section id="slik-fungerer-det" className="border-b bg-muted/30">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <div className="mb-12 max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Slik fungerer det
          </h2>
          <p className="mt-3 text-muted-foreground">
            Fra innkommet søknad til begrunnet vurdering i tre steg.
          </p>
        </div>
        <div className="grid gap-8 md:grid-cols-3 md:gap-10">
          {STEPS.map(({ number, icon: Icon, title, body }) => (
            <div key={number} className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm text-muted-foreground">
                  {number}
                </span>
                <span className="h-px flex-1 bg-border" />
                <Icon className="size-5 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold">{title}</h3>
              <p className="text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add components/landing/how.tsx
git commit -m "feat(landing): add 'Slik fungerer det' section"
```

---

## Task 7: Build Funksjoner section

**Files:**
- Create: `components/landing/features.tsx`

- [ ] **Step 1: Create `components/landing/features.tsx`**

```tsx
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add components/landing/features.tsx
git commit -m "feat(landing): add 'Funksjoner' section"
```

---

## Task 8: Build Lovverk og sitering section

**Files:**
- Create: `components/landing/legal.tsx`

- [ ] **Step 1: Create `components/landing/legal.tsx`**

```tsx
import { ScrollText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function Legal() {
  return (
    <section id="lovverk" className="border-b bg-muted/30">
      <div className="mx-auto max-w-3xl px-6 py-20 md:py-28">
        <div className="mb-8 flex items-center gap-3">
          <ScrollText className="size-6 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">
            Lovverk og sitering
          </span>
        </div>
        <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
          Laget for norsk forvaltningsrett
        </h2>
        <p className="mt-4 text-muted-foreground">
          Boetta bruker DIBKs offisielle nasjonale sjekklister som kilde.
          Hvert sjekkpunkt er knyttet til riktig lovhjemmel — plan- og
          bygningsloven, SAK10, TEK17. Når Boetta konkluderer, ser du
          nøyaktig hvilken paragraf og hvilket sjekkpunkt vurderingen
          bygger på.
        </p>
        <Card className="mt-8 border-l-4 border-l-primary">
          <CardContent className="p-6">
            <p className="text-base italic">
              “Søknaden mangler dokumentasjon på ansvarlig søkers
              kvalifikasjoner, jf. SAK10 § 5-4 første ledd.”
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              — eksempel på generert vurdering
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add components/landing/legal.tsx
git commit -m "feat(landing): add 'Lovverk og sitering' section"
```

---

## Task 9: Build Personvern og sikkerhet section

**Files:**
- Create: `components/landing/security.tsx`

- [ ] **Step 1: Create `components/landing/security.tsx`**

```tsx
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add components/landing/security.tsx
git commit -m "feat(landing): add 'Personvern og sikkerhet' section"
```

---

## Task 10: Build For kommuner og foretak section

**Files:**
- Create: `components/landing/audience.tsx`

- [ ] **Step 1: Create `components/landing/audience.tsx`**

```tsx
import { Landmark, Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ITEMS = [
  {
    icon: Landmark,
    title: "Kommuner",
    body: "For saksbehandlere i bygg- og reguleringsavdelingen. Hele teamet får tilgang, med deling av saker internt.",
  },
  {
    icon: Building2,
    title: "Ansvarlig søker og foretak",
    body: "For utbyggere og arkitektkontor som vil kvalitetssikre søknaden før den sendes inn.",
  },
];

export function Audience() {
  return (
    <section id="for-hvem" className="border-b bg-muted/30">
      <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
        <div className="mb-12 max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
            For kommuner og foretak
          </h2>
          <p className="mt-3 text-muted-foreground">
            Samme sjekklister — to bruksmønstre.
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add components/landing/audience.tsx
git commit -m "feat(landing): add 'For kommuner og foretak' section"
```

---

## Task 11: Build Kom i gang (CTA) section

**Files:**
- Create: `components/landing/cta.tsx`

- [ ] **Step 1: Create `components/landing/cta.tsx`**

```tsx
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add components/landing/cta.tsx
git commit -m "feat(landing): add 'Kom i gang' CTA section"
```

---

## Task 12: Compose landing page at `app/page.tsx`

**Files:**
- Create: `app/page.tsx`

- [ ] **Step 1: Create `app/page.tsx`**

```tsx
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run the dev server and visually verify**

Run (in a separate terminal if not already running): `bun dev`

Open `http://localhost:3000/` in a browser. Verify:
- Hero renders with H1 "Byggesaksvurdering som står seg juridisk"
- All seven section headings appear in order: Hvorfor Boetta, Slik fungerer det, Funksjoner, Laget for norsk forvaltningsrett, Personvern og sikkerhet, For kommuner og foretak, Klar til å prøve Boetta?
- Sticky nav stays visible while scrolling
- Anchor links (e.g., clicking "Sikkerhet") scroll to the correct section
- "Kom i gang" / "Kontakt oss" buttons open a `mailto:` dialog
- "Logg inn" navigates to `/sign-in`
- Footer links navigate (currently 404 — next task fixes that)
- No console errors

- [ ] **Step 4: Verify mobile layout**

In browser devtools, toggle device toolbar and test at 375px wide. Verify:
- Mobile hamburger menu opens and closes
- All sections stack into single column
- No horizontal scroll

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "feat(landing): compose landing page at /"
```

---

## Task 13: Build placeholder pages

**Files:**
- Create: `app/personvern/page.tsx`
- Create: `app/vilkar/page.tsx`
- Create: `app/kontakt/page.tsx`

- [ ] **Step 1: Create `app/personvern/page.tsx`**

```tsx
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
```

- [ ] **Step 2: Create `app/vilkar/page.tsx`**

```tsx
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
```

- [ ] **Step 3: Create `app/kontakt/page.tsx`**

```tsx
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
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Visual verification**

Open in browser:
- `http://localhost:3000/personvern` — renders with banner + skeleton sections
- `http://localhost:3000/vilkar` — renders with banner + skeleton sections
- `http://localhost:3000/kontakt` — renders with banner + mailto link

Click the footer links on `/` to verify they all navigate correctly.

- [ ] **Step 6: Commit**

```bash
git add app/personvern/page.tsx app/vilkar/page.tsx app/kontakt/page.tsx
git commit -m "feat(landing): add placeholder /personvern, /vilkar, /kontakt pages"
```

---

## Task 14: End-to-end smoke test

**Files:** (none — verification only)

- [ ] **Step 1: Production build**

Run: `bun run build`
Expected: Build succeeds, no type errors, no lint errors.

If the build surfaces Clerk warnings about missing env vars, those are expected if you don't have a live Clerk dev key — they existed before this plan.

- [ ] **Step 2: Test the full auth flow manually**

With `bun dev` running and real Clerk/Neon env vars set:

1. Open `http://localhost:3000/` (signed out) → landing page renders. Nav shows "Logg inn" / "Kom i gang".
2. Click "Logg inn" → Clerk sign-in screen.
3. Complete sign-in with an **already-onboarded, active-entitlement** account → lands at `/agent` (NOT `/`).
4. Click "Boetta" wordmark in nav → back at `/` landing, with UserButton + OrganizationSwitcher visible in top-right corner.
5. Navigate to `/agent/<known-session-id>` → session loads.
6. Sign out. Visit `/agent` → redirected to `/sign-in`.
7. Sign up a brand-new account (or use an account with no org) → lands at `/onboarding`. Complete org onboarding → lands at `/pending`. Approve via `/admin` → activating org redirects into `/agent` on next navigation.
8. Visit `/personvern`, `/vilkar`, `/kontakt` while signed out → all render with the amber banner.

- [ ] **Step 3: Verify `bun test` still green**

Run: `bun test`
Expected: All pre-existing tests pass.

- [ ] **Step 4: Final review commit (if anything was adjusted during smoke test)**

```bash
git status
# If any adjustments, stage and commit them with a descriptive message.
# If nothing to commit, skip.
```

---

## Done

The branch should now contain:
- A public Norwegian landing page at `/`
- Chat app relocated to `/agent` and `/agent/[sessionId]`
- Three placeholder pages with prominent "replace before launch" banner
- Middleware widened for public routes
- All redirect targets pointing to `/agent`

Merge to main when the smoke test passes and content copy has been reviewed.
