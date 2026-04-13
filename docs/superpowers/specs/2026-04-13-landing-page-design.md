# Landing Page + `/agent` Routing Restructure

## Goal

Move the existing chat app from `/` to `/agent`, and introduce a public Norwegian-language marketing landing page at `/` aimed at Norwegian municipalities (kommuner) and ansvarlig foretak. The landing page should showcase Boetta's functionality (byggesaksvurdering basert på DIBKs nasjonale sjekklister), how it works, and its security/compliance posture.

## Decisions

- **Language:** Norwegian Bokmål. Matches the app's Clerk locale (`nbNO`) and the target audience.
- **Structure:** Single long scrolling page with a sticky top nav using anchor links. One `app/page.tsx`.
- **App routing:** New prefix `/agent` for the chat experience. `/` is public; `/agent` and deeper are auth-gated as before.
- **Security claims:** Only verifiable ones — Clerk SOC 2 Type II, Neon EU-region + encryption at rest/in transit, Anthropic zero-data-retention + TLS. No invented certifications.
- **Contact:** `mailto:espennoreng@gmail.com` for now. No contact form.
- **Branding:** Wordmark "Boetta" in Inter (already loaded). No logo asset.
- **Pricing:** No public pricing page. Kommuner procure via offentlig anskaffelse; CTA is "Kontakt oss for tilbud".
- **Social proof:** None yet (no customer logos / testimonials invented).
- **Layout chrome:** Keep the existing `<Show when="signed-in">` UserButton + OrganizationSwitcher in `app/layout.tsx` — it renders on both the landing page (helpful: signed-in visitors see their account) and the app.

## Architecture

### Routing changes

| Before | After | Auth |
|---|---|---|
| `app/page.tsx` (ChatPage) | `app/agent/page.tsx` | auth-gated |
| `app/[sessionId]/page.tsx` | `app/agent/[sessionId]/page.tsx` | auth-gated |
| — | `app/page.tsx` (new landing) | public |
| `app/sign-in`, `app/sign-up` | unchanged | public |
| `app/onboarding`, `app/pending`, `app/admin` | unchanged | unchanged |
| `app/api/*` | unchanged | unchanged |

### Middleware (`proxy.ts`) changes

- Add `/` (exact match) to `isPublicRoute` so unauthenticated visitors can load the landing page.
- Entitlement gate already only triggers for authenticated users with an org, so it won't affect landing-page visitors. A signed-in active user who visits `/` sees the landing page; they can click "Gå til Boetta" to enter `/agent`. This is intentional and fine.
- No new routes are added to the matcher — the existing matcher already covers `/`.

### Redirect target updates

Every place that currently redirects to `/` (meaning "into the app") must redirect to `/agent` instead:

- `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL`: `/` → `/agent`. `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` stays `/onboarding` (new users still go through org onboarding).
- `app/layout.tsx`: `afterSelectOrganizationUrl="/"` → `/agent`. `afterCreateOrganizationUrl="/pending"` stays unchanged (newly created orgs still need super-admin approval).
- `app/onboarding/page.tsx`: `if (orgId) redirect("/")` → `/agent`
- `app/pending/page.tsx`: `if (status === "active") redirect("/")` → `/agent`
- `app/admin/layout.tsx`: `redirect("/")` → `/agent`
- `app/agent/[sessionId]/page.tsx` (after move): fallback `<a href="/">` → `<a href="/agent">`
- `.env.local.example`: update `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` to `/agent`

Sign-up after-URL stays as `/onboarding` (unchanged). After-sign-in URL becomes `/agent`.

## Landing Page Structure

### Global chrome
- **Sticky top nav** (h-16, backdrop-blur, border-b)
  - Left: wordmark **Boetta** (Inter, font-semibold)
  - Center (md+): anchor links — Hvorfor · Slik fungerer det · Sikkerhet · Kontakt
  - Right: `[Logg inn]` (ghost button → `/sign-in`) + `[Kom i gang]` (primary button → `mailto:espennoreng@gmail.com`)
  - Mobile: hamburger collapses center links into a shadcn `Sheet` or simple `DropdownMenu`
- **Footer** (minimal)
  - "© 2026 Boetta" + small links: Personvern · Vilkår · Kontakt (mailto)
  - Footer links can point to `#` placeholders for now; we add real pages later.

### Sections (top to bottom)

#### 1. Hero (`#top`, no id — above the fold)
- **H1:** *Byggesaksvurdering som står seg juridisk*
- **Subtitle:** *Boetta leser byggesøknader, matcher dem mot DIBKs nasjonale sjekklister, og gir deg begrunnede vurderinger med henvisninger til PBL og SAK10 — slik at du kan fatte vedtak raskere og tryggere.*
- **CTAs:** `[Kom i gang]` (primary, mailto) + `[Se hvordan det fungerer]` (ghost, anchor to `#slik-fungerer-det`)
- **Visual:** a static 3-card strip mocking the pipeline (søknad → sjekkliste → vurdering). Uses shadcn `Card`. No live data, no interactivity — it's illustrative. Can be a simple right-aligned column on desktop, stacked on mobile.

#### 2. Hvorfor Boetta (`#hvorfor`)
Three-column grid of shadcn `Card`s (1-col mobile, 3-col md+):

- **12-ukers fristen** — *Stadig flere søknader, samme bemanning. Boetta kutter gjennomgangstiden fra timer til minutter.*
- **Begrunnelseskravet** — *Forvaltningsloven krever at vedtak begrunnes. Boetta siterer lovteksten direkte, slik at vedtaket ditt holder ved klage.*
- **Ny på kontoret** — *Nye saksbehandlere kommer raskere i gang. Boetta viser hvilke sjekkpunkter som gjelder for akkurat denne tiltakstypen.*

Icons (lucide): `Clock`, `Scale`, `GraduationCap`.

#### 3. Slik fungerer det (`#slik-fungerer-det`)
Three vertical steps with icons (lucide `Upload`, `ListChecks`, `ScrollText`), each with a small heading + short body. Layout: stacked rows on mobile, 3-column with step numbers on md+.

1. **Last opp søknad** — *Dra inn PDF-en. Boetta identifiserer søknadstype (RS, ET, IG, FA, ES, MB, NV, TA) og tiltakstype automatisk.*
2. **Sjekkliste matches** — *Riktig DIBK-sjekkliste hentes. Boetta går gjennom sjekkpunktene og markerer hva som er dekket og hva som mangler.*
3. **Begrunnet vurdering** — *Du får en vurdering med lovhenvisninger (PBL § 21-2, SAK10 § 5-4) og kildesitater — klar til å lime inn i vedtaket.*

#### 4. Funksjoner (`#funksjoner`)
4 shadcn `Card`s, 2×2 on desktop:

- **PDF-lesing** — *Leser store søknadsbunker direkte. Ingen manuell transkribering.*
- **DIBKs sjekklister** — *Hele den nasjonale sjekklisten, filtrert på tiltakstype. 130 sjekkpunkter, kun de relevante.*
- **Lovhenvisninger og sitater** — *Hvert funn er knyttet til konkret lovtekst i PBL eller SAK10 — med sitat.*
- **Revisjonsspor** — *Alle saker og vurderinger lagres per organisasjon. Du ser hvem som åpnet hva, når.*

Icons (lucide): `FileText`, `ListChecks`, `BookMarked`, `History`.

#### 5. Lovverk og sitering (`#lovverk`)
Narrower single-column section (max-w-3xl, centered). Uses shadcn `Alert` + a nested `Card` quote.

- **H2:** *Laget for norsk forvaltningsrett*
- **Body:** *Boetta bruker DIBKs offisielle nasjonale sjekklister som kilde. Hvert sjekkpunkt er knyttet til riktig lovhjemmel — plan- og bygningsloven, SAK10, TEK17. Når Boetta konkluderer, ser du nøyaktig hvilken paragraf og hvilket sjekkpunkt vurderingen bygger på.*
- **Example snippet** (shadcn `Card` with border-l accent):
  > *"Søknaden mangler dokumentasjon på ansvarlig søkers kvalifikasjoner, jf. SAK10 § 5-4 første ledd."*
  >
  > — eksempel på generert vurdering

#### 6. Personvern og sikkerhet (`#sikkerhet`)
4 shadcn `Card`s, 2×2 on desktop. Each with a lucide icon and a 1-2 sentence body.

- **GDPR og databehandleravtale** (icon: `ShieldCheck`) — *Vi inngår databehandleravtale med hver kommune. Data behandles i samsvar med personvernforordningen.*
- **Autentisering med Clerk** (icon: `KeyRound`) — *Pålogging og organisasjonshåndtering via Clerk (SOC 2 Type II-sertifisert). MFA støttes.*
- **Lagring i EU** (icon: `Server`) — *Neon Postgres i EU-region. Kryptert i ro og i transitt.*
- **Kontrollert AI-leverandør** (icon: `Lock`) — *Vi bruker Anthropic Claude med zero-data-retention: Anthropic lagrer ikke innholdet i søknadene dine, og bruker det ikke til trening. All trafikk krypteres med TLS.*

Only claims backed by published certifications / vendor terms. No invented SOC 2 claim for Boetta itself.

#### 7. For kommuner og foretak (`#for-hvem`)
Two-column shadcn `Card`s (1-col mobile, 2-col md+):

- **Kommuner** — *For saksbehandlere i bygg- og reguleringsavdelingen. Hele teamet får tilgang, med deling av saker internt.*
- **Ansvarlig søker og foretak** — *For utbyggere og arkitektkontor som vil kvalitetssikre søknaden før den sendes inn.*

#### 8. Kom i gang (`#kontakt`)
Centered CTA band, full-width background tint (muted).

- **H2:** *Klar til å prøve Boetta?*
- **Body:** *Vi er i tidlig pilot med utvalgte kommuner. Ta kontakt for et tilbud eller for å avtale en demo.*
- **Primary button:** `[Kontakt oss]` → `mailto:espennoreng@gmail.com?subject=Interessert%20i%20Boetta`
- **Secondary button:** `[Logg inn]` → `/sign-in`

## Components

All new components live under `components/landing/`:

- `components/landing/nav.tsx` — sticky top nav (client component for mobile menu state)
- `components/landing/hero.tsx` — hero section
- `components/landing/why.tsx` — hvorfor section
- `components/landing/how.tsx` — slik fungerer det
- `components/landing/features.tsx` — funksjoner grid
- `components/landing/legal.tsx` — lovverk og sitering
- `components/landing/security.tsx` — personvern og sikkerhet
- `components/landing/audience.tsx` — for kommuner og foretak
- `components/landing/cta.tsx` — kom i gang band
- `components/landing/footer.tsx` — footer

`app/page.tsx` composes these in order. It is a server component; only `nav.tsx` is a client component (for mobile menu state and anchor scroll behavior).

## Styling

- Uses existing shadcn theme in `app/globals.css`. No new colors added.
- Inter font already loaded via `next/font/google` in `app/layout.tsx` (variable `--font-sans`). No font changes.
- All sections use `max-w-6xl mx-auto px-6 py-20 md:py-28` pattern for consistent rhythm.
- Headings scaled: hero H1 `text-4xl md:text-6xl`, section H2 `text-3xl md:text-4xl`, card titles `text-lg`.
- Accent color: default shadcn `primary`.

## Testing

The landing page is presentational static content with no business logic. Manual verification is sufficient:

1. **Routing smoke test** (manual, `bun dev`):
   - Unauthed visit to `/` → landing page renders
   - Unauthed click on "Logg inn" → `/sign-in`
   - Post sign-in → lands at `/agent` (chat home)
   - Existing session deeplink `/agent/<sessionId>` works
   - Onboarding → approved → redirect goes to `/agent`
   - Signed-in visit to `/` still works (landing page + UserButton in corner)
2. **Existing test suites (`bun test`)** should continue to pass unchanged. The only touched non-landing code is redirect strings in page/middleware files, which aren't covered by unit tests, and a handful of existing tests in `lib/audit.test.ts` / `lib/auth.test.ts` that don't depend on the redirect paths.
3. **Mobile responsiveness** — verify at 375px (mobile), 768px (tablet), and 1280px (desktop) in browser devtools.

## Files Touched

**New:**
- `app/page.tsx` (replaces old root page)
- `components/landing/*.tsx` (10 files as listed above)

**Moved:**
- `app/page.tsx` → `app/agent/page.tsx`
- `app/[sessionId]/page.tsx` → `app/agent/[sessionId]/page.tsx`

**Modified:**
- `proxy.ts` — add `/` to `isPublicRoute`
- `app/layout.tsx` — `afterSelectOrganizationUrl` only (`afterCreateOrganizationUrl` stays)
- `app/onboarding/page.tsx` — redirect target
- `app/pending/page.tsx` — redirect target
- `app/admin/layout.tsx` — redirect target
- `app/agent/[sessionId]/page.tsx` — fallback link href (after move)
- `.env.local.example` — after-sign-in URL

**Env (deployment):**
- Update `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` to `/agent` in whatever env management you use (Vercel, etc.). The example file is updated; the actual env needs to be changed manually.

## Out of scope

- Contact form with server action (mailto is sufficient)
- Pricing page
- Customer logos / testimonials (nothing real yet)
- Blog / content marketing
- SEO metadata beyond existing `metadata` export (can be tuned later)
- Internationalization beyond Norwegian
- Analytics (no tracking added)
- Real Personvern/Vilkår pages (footer links point to `#` until written)
