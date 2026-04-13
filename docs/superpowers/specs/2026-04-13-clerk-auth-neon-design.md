# Clerk Auth + Neon Entitlements

## Goal

Add Clerk-based auth to boetta-v2 with Clerk organizations, a Municipality-vs-Business distinction, and a super-admin-gated entitlement system so only approved organizations can use the app. Introduce Neon Postgres (via Drizzle) as a lightweight MVP database for the three things Clerk and Anthropic don't store: entitlements, session ownership, and a minimal audit log.

## Decisions

- **Auth provider:** Clerk (users, organizations, org membership).
- **Tenant model:** **Organizations only.** Every user must belong to an org to use the app. Solo users deferred.
- **Two org types:** `municipality` and `business`, stored in `clerkOrg.publicMetadata.orgType`.
- **Access gate:** DIY `entitlements` table in Neon. A super-admin approves orgs manually. No self-serve activation.
- **Super-admin:** Clerk user(s) with `publicMetadata.role === "superadmin"`. Controls the `/admin` approval surface and can edit any org's `orgType` at approval time.
- **Audit trail:** minimal — who signed in, who created/opened a session, who approved/suspended entitlements.
- **Session visibility:** all members of an org can see all of that org's sessions.
- **Database:** Neon serverless Postgres, two drivers — HTTP in edge middleware, Pool in Node runtime (for transactions).
- **ORM:** Drizzle with `drizzle-kit` migrations.
- **Deployment target:** Vercel.
- **Source-of-truth split:**
  - **Clerk** — users, orgs, memberships, org type (`publicMetadata.orgType`), super-admin flag (`publicMetadata.role`).
  - **Neon** — entitlements, session ownership, audit log.
  - **Anthropic Managed Agents** — conversation history, PDFs, tool traces, session metadata.

No data is mirrored between Clerk and Neon; Clerk IDs are stored in Neon as plain strings.

## Architecture

```
Browser (Clerk cookie)
  │
  ▼
Next.js middleware (edge runtime)
  ├─ clerkMiddleware() — redirect to sign-in if unauthenticated
  ├─ pass-through for /sign-in, /sign-up, /onboarding, /pending, /admin
  └─ Entitlement gate:
       if no active org in Clerk session → redirect /onboarding
       SELECT status FROM entitlements WHERE clerk_org_id = ?
         no row    → insert pending, redirect /pending
         not active → redirect /pending
  │
  ▼
App routes (Node runtime)
  ├─ server actions, API routes
  ├─ lib/auth.ts   — getCurrentContext(), requireSuperadmin()
  ├─ lib/db/       — Drizzle client (Pool) + schema + queries
  └─ lib/audit.ts  — logEvent()
  │
  ▼                         ▼                          ▼
Neon Postgres           Clerk                      Anthropic Managed Agents
(entitlements,          (users, orgs,              (sessions, events,
 session_ownership,      memberships,               files, metadata)
 audit_log)              publicMetadata)
```

## Database Schema

Three tables. All timestamps are `timestamptz` with `default now()`. Clerk IDs are stored as `text`.

### `entitlements`

```
entitlements
  id              uuid pk default gen_random_uuid()
  clerk_org_id    text unique not null
  status          text not null        -- 'pending' | 'active' | 'suspended'
  approved_at     timestamptz null
  approved_by     text null            -- clerk user_id of super-admin
  notes           text null
  created_at      timestamptz not null default now()
  updated_at      timestamptz not null default now()
```

One row per Clerk organization. First contact from a new org upserts a `pending` row; super-admin flips to `active`.

### `session_ownership`

```
session_ownership
  anthropic_session_id  text primary key
  clerk_org_id          text not null
  clerk_user_id         text not null   -- creator
  title                 text null
  created_at            timestamptz not null default now()
  archived_at           timestamptz null
  index on (clerk_org_id, created_at desc)
```

Owns the mapping from Anthropic's session ID back to the Clerk org that owns it. Queried for the "my org's sessions" list.

### `audit_log`

```
audit_log
  id             bigserial primary key
  actor_user_id  text not null         -- clerk user_id
  actor_org_id   text null             -- active org at event time (null for super-admin actions outside an org)
  event          text not null
  subject_type   text null             -- 'session' | 'entitlement' | null
  subject_id     text null
  created_at     timestamptz not null default now()
  index on (actor_org_id, created_at desc)
  index on (actor_user_id, created_at desc)
```

Event values for MVP: `user.signed_in`, `session.created`, `session.opened`, `entitlement.approved`, `entitlement.suspended`.

Append-only by convention — the app never updates or deletes rows. (Not enforced at DB level for MVP; true immutability is out of scope.)

## Clerk Integration

### Packages

- `@clerk/nextjs` for auth + middleware + React components + server helpers.

### Environment variables

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/onboarding
DATABASE_URL            # Neon pooled connection string
```

### Clerk dashboard settings

- Enable **Organizations**.
- Require every user to have an active org (no personal workspace).
- Under Organizations → Roles & Permissions: keep Clerk's default `admin`/`member` roles. Not used for gating in MVP.
- Create a super-admin user manually and set `publicMetadata = { role: "superadmin" }` via Clerk dashboard.

### Onboarding flow

1. User signs up via `<SignUp />`.
2. Clerk redirects to `/onboarding`.
3. `/onboarding` page presents two actions:
   - **Create organization** — Clerk's `createOrganization()` helper. After creation, the form asks for `orgType` (`municipality` | `business`) and writes it to `publicMetadata` via a server action. The entitlement is upserted as `pending` in the same action.
   - **Join existing** — pasted invite link or awaiting invite.
4. User lands on `/pending` until super-admin approves.

Org creators cannot change `orgType` themselves after onboarding; only the super-admin can, via `/admin`.

## Middleware

File: `middleware.ts` at project root. Runs on edge runtime.

```
export default clerkMiddleware(async (auth, req) => {
  const { userId, orgId } = await auth();
  const path = req.nextUrl.pathname;

  // Allow public + self-service paths
  if (isPublicRoute(path)) return;                  // /sign-in, /sign-up, /
  if (path.startsWith("/onboarding")) return;
  if (path.startsWith("/pending")) return;
  if (path.startsWith("/admin")) {
    // super-admin only; checked in page + layout via requireSuperadmin()
    return;
  }

  if (!userId) return auth.redirectToSignIn();

  if (!orgId) return NextResponse.redirect(new URL("/onboarding", req.url));

  // Edge-safe single query via neon-http
  const status = await lookupEntitlementStatus(orgId);
  if (status !== "active") {
    return NextResponse.redirect(new URL("/pending", req.url));
  }
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
```

`lookupEntitlementStatus` uses `drizzle-orm/neon-http`. It returns `"none" | "pending" | "active" | "suspended"`. If `"none"`, the user is redirected to `/pending`; the upsert-to-pending happens from the Node-runtime server action triggered by `/pending`'s first render (or during onboarding org creation).

## Admin Surface

File: `app/admin/page.tsx` — server component. Gated by `requireSuperadmin()` which throws if `sessionClaims.publicMetadata.role !== "superadmin"`.

The page shows a single table of all entitlements, ordered pending-first:

| Org name (from Clerk) | Org type | Status | Requested | Actions |

Actions are server actions in `app/admin/actions.ts`:

- `approveOrg(clerkOrgId, orgType)` — inside a transaction: update `entitlements.status = 'active'`, set `approved_at`, `approved_by`; update Clerk org `publicMetadata.orgType` via backend SDK; insert `audit_log` row with `event = 'entitlement.approved'`.
- `suspendOrg(clerkOrgId, notes)` — similar, status → `'suspended'`, event `'entitlement.suspended'`.

Super-admin can set `orgType` at approval time (overriding whatever the org creator picked, if wrong).

## Changes to Existing Code

### `app/layout.tsx`

Wrap `{children}` in `<ClerkProvider>`. No other changes.

### `lib/agent-manager.ts`

`createSession()` currently takes no args. Change to:

```
createSession(params: { clerkOrgId: string; clerkUserId: string }): Promise<string>
```

After Anthropic returns a session ID, insert a `session_ownership` row with `(anthropic_session_id, clerk_org_id, clerk_user_id)`. Pass `metadata: { clerkOrgId, clerkUserId }` to Anthropic's session creation call as a secondary source of truth (lets us reconstruct ownership if Neon is rebuilt).

### `app/api/chat/route.ts`

Derive `{ userId, orgId }` from `auth()`. Before streaming:

1. If `sessionId` is supplied in the request, verify `session_ownership.clerk_org_id === orgId`. Otherwise 403.
2. Log `audit_log` event `session.opened` for follow-up messages, or `session.created` for the first message.

### `app/page.tsx` / `components/chat-page.tsx`

Show a "my org's sessions" sidebar: query `session_ownership` where `clerk_org_id = orgId`, ordered `created_at desc`. Out of scope for first cut — can ship with a single-session experience and add the sidebar later.

## File Layout

```
middleware.ts                               — Clerk + entitlement gate
drizzle.config.ts                           — drizzle-kit config
drizzle/                                    — generated migrations (committed)

app/
  layout.tsx                                — wrapped in <ClerkProvider>
  sign-in/[[...sign-in]]/page.tsx           — Clerk catch-all
  sign-up/[[...sign-up]]/page.tsx           — Clerk catch-all
  onboarding/page.tsx                       — create/join org, pick orgType
  onboarding/actions.ts                     — createOrgWithType server action
  pending/page.tsx                          — "waiting for approval" screen
  admin/layout.tsx                          — requireSuperadmin()
  admin/page.tsx                            — entitlements table
  admin/actions.ts                          — approveOrg, suspendOrg server actions
  api/chat/route.ts                         — (modified) auth + ownership + audit

lib/
  auth.ts                                   — getCurrentContext(), requireSuperadmin()
  audit.ts                                  — logEvent()
  db/
    edge.ts                                 — Drizzle via neon-http (middleware)
    index.ts                                — Drizzle via neon-serverless Pool (Node)
    schema.ts                               — three tables
    queries.ts                              — lookupEntitlementStatus, recordOwnership, etc.
```

## Drizzle Configuration

`drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL! },
  casing: "snake_case",
});
```

`package.json` scripts:

```
"db:generate": "drizzle-kit generate",
"db:migrate":  "drizzle-kit migrate",
"db:studio":   "drizzle-kit studio"
```

Migrations are committed to `drizzle/` and applied via `drizzle-kit migrate` as part of the Vercel build step (or a one-off script).

## Error Handling

- Middleware DB lookup failure → fail closed: render a 503 "service unavailable" page (not `/pending`, which has a specific meaning). Errors are logged to Vercel. Middleware holds a single `neon()` HTTP client; no retry loop — one attempt per request.
- Anthropic `createSession` succeeds but `session_ownership` insert fails → the Anthropic session is orphaned (no ownership row, inaccessible). Acceptable for MVP; a background reaper can be added later by listing Anthropic sessions and cross-checking ownership.
- Clerk `publicMetadata` write fails during approval → transaction rolls back the entitlement update; super-admin sees an error toast and can retry.
- Super-admin gate in `/admin` is checked at both layout and each server action (defense in depth).

## Testing Strategy

- **Unit:** `lib/auth.ts` (subject derivation), `lib/db/queries.ts` (entitlement status transitions), `lib/audit.ts`.
- **Integration:** middleware redirect matrix — unauth'd, no org, pending, active, suspended, super-admin. Using a disposable Neon branch per test run.
- **Manual:** full signup → onboarding → pending → approve → chat flow in staging.

Test framework decision is deferred to the implementation plan (no test tooling exists in the repo yet).

## Out of Scope (Deferred)

- **Solo users** — individual users without an org. Add a `user_entitlements` table or reintroduce `subject_type`/`subject_id` when needed.
- **Free-trial quotas** (session count, token count) — slots into `entitlements` as additional columns plus a token-counting hook in the event loop.
- **Stripe / automated billing.**
- **Org admin self-service for `orgType`.** Super-admin handles this at approval time; if misconfigured, super-admin can edit later.
- **Arkivloven-grade audit** — append-only enforcement, retention policies, tamper evidence.
- **Cross-org sponsorship** ("Oslo kommune pays for architect X's access").
- **Session sidebar / multi-session UI.** Current app is single-session; the sidebar is a follow-up.
- **Session sharing granularity** — all org members can see all org sessions.
- **Background reaper** for orphaned Anthropic sessions.

## Implications / Future-Proofing

- The `entitlements` table is the natural surface for billing. When Stripe arrives, add `stripe_customer_id` and `stripe_subscription_id` columns; webhook handlers flip `status` automatically instead of manually.
- `subject_type` can be reintroduced when solo users are added; migration is trivial because we haven't coupled any code to the column's absence.
- `audit_log` is kept minimal; upgrading to arkivloven compliance means adding an append-only trigger, WORM storage, and a retention job — none of which require schema rewrites, only additions.
