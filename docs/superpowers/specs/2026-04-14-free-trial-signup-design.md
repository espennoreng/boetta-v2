# Free-trial signup (replace admin approval)

**Status:** Draft
**Date:** 2026-04-14

## Problem

Today every new Clerk organization lands on `/pending` until a superadmin approves it at `/admin`, setting the org's `orgType` (`municipality` | `tiltakshaver`) in the process. The approval queue is a bottleneck: anyone signing up to evaluate the product has to wait for a human, and the superadmin tooling is more weight than the early-stage product needs.

We want every signup to get immediate, self-serve access via a 14-day free trial. After 14 days access hard-blocks until we manually upgrade the org (one SQL update). Per-org disable is handled via the Clerk dashboard (ban user, delete org) — no bespoke admin UI.

## Non-goals

- Payment / billing integration. Conversion from trial to paid is a manual SQL update for now.
- Trial extensions via UI. One-off extensions are a SQL update.
- A self-serve "upgrade" flow on the expired page.
- Usage-based limits (message counts, run counts). Trial is purely time-based.
- Retaining the `superadmin` role. No code in this spec requires it; we just stop using it.

## Design

### Entitlement model

Current columns `approved_at`, `approved_by`, `notes` are dropped. Column `trial_ends_at` is added.

```
entitlements
  id              uuid pk
  clerk_org_id    text unique
  status          text        -- 'trial' | 'active' | 'expired'
  trial_ends_at   timestamptz -- null when status='active' (paid/unlimited)
  created_at, updated_at
```

Status transitions:

| From → To            | Trigger                                                       |
|----------------------|---------------------------------------------------------------|
| (none) → `trial`     | User completes `/onboarding/org-type` — row inserted          |
| `trial` → `expired`  | Middleware detects `now() >= trial_ends_at`, flips lazily     |
| `trial` → `active`   | Manual SQL when converting to paid customer                   |
| `active` → `expired` | Manual SQL (e.g. revoke paid access)                          |
| any → (deleted)      | Clerk org deleted via dashboard — row becomes dead but harmless |

Audit events update:

- Drop: `entitlement.approved`, `entitlement.suspended`
- Add: `entitlement.created`, `entitlement.expired`

`entitlement.expired` is logged by the middleware at the moment of the lazy flip.

### Onboarding flow

```
/sign-up  →  /onboarding          →  /onboarding/org-type     →  /agent
             (Clerk org create       (pick Kommune/              (trial active
              or select)               Tiltakshaver, create        for 14 days)
                                       entitlement row)
```

`/onboarding` keeps Clerk's `<OrganizationList>` but points `afterCreateOrganizationUrl` and `afterSelectOrganizationUrl` at `/onboarding/org-type`.

`/onboarding/org-type` is a new server component rendering two radio cards (Kommune / Tiltakshaver) and a submit button. The submit action:

1. Asserts auth + active orgId, redirects if missing.
2. Writes `orgType` to the Clerk org's `publicMetadata`.
3. Upserts the entitlement row: `status='trial'`, `trial_ends_at = now() + interval '14 days'`.
4. Logs audit event `entitlement.created`.
5. Redirects to `/agent`.

Idempotency: if the Clerk org already has `orgType` set and an entitlement row exists, the page redirects to `/agent` on mount. This handles refreshes and users returning mid-flow.

### Middleware (`proxy.ts`)

`/onboarding/org-type` and `/trial-expired` are carved out of the orgType and entitlement gates (same pattern as today's `/pending` carve-out), otherwise they'd redirect to themselves in a loop.

Gate order:

1. **Auth gate** (unchanged): no session → redirect to sign-in.
2. **Org gate** (unchanged): no `orgId` → `/onboarding`.
3. **orgType gate** (new): `orgId` present, not on `/onboarding/org-type`, but Clerk org's `publicMetadata.orgType` not set → `/onboarding/org-type`.
4. **Entitlement gate** (revised, skipped when on `/onboarding/org-type` or `/trial-expired`):
    - `status='active'` → allow
    - `status='trial'` AND `now() < trial_ends_at` → allow
    - `status='trial'` AND `now() >= trial_ends_at` → flip to `expired` + audit log, then redirect to `/trial-expired`
    - `status='expired'` → redirect to `/trial-expired`
    - no row → redirect to `/onboarding/org-type`

Removed from middleware:

- `/admin` matcher and the "admin bypass" branch
- `/pending` matcher (replaced by `/trial-expired`, which gets the same carve-out)

The lazy `trial → expired` flip is a single UPDATE per org lifetime. Acceptable cost for keeping the DB state accurate (so "who's expired" is a simple query).

### `/trial-expired` page

Replaces `/pending`. Route path `/trial-expired`. Accessible to any authenticated user with an orgId (same carve-out `/pending` has today).

Contents:
- Headline: "Prøveperioden er utløpt"
- Body: one sentence that the 14-day trial has ended
- Org name + the date the trial ended (`trial_ends_at`, formatted)
- CTA: "Kontakt oss" → link to `/kontakt`
- Footer: Clerk `<SignOutButton>`

Behaviour: if the current org's entitlement is `active`, redirect to `/agent` (handles bookmarked access by paid users).

No separate "suspended" branch. Clerk dashboard bans/deletes are enforced by Clerk itself — a banned user can't reach this page at all.

### Removals

Delete:
- `app/admin/` (page.tsx, actions.ts, layout.tsx)
- `app/pending/` (replaced by `/trial-expired`)
- In `lib/auth.ts`: `requireSuperadmin`, `NotSuperadminError`, `isSuperadmin`
- In `lib/db/queries.ts`: `approveEntitlement`, `suspendEntitlement`, `upsertPendingEntitlement`
- `admin` route matcher in `proxy.ts`

The `superadmin` role in Clerk user `publicMetadata` becomes unused. No code change needed; can be cleared manually in Clerk dashboard when convenient.

### Schema migration

New Drizzle migration:

```sql
ALTER TABLE entitlements
  DROP COLUMN approved_at,
  DROP COLUMN approved_by,
  DROP COLUMN notes,
  ADD COLUMN trial_ends_at timestamptz;

-- Backfill existing rows
UPDATE entitlements SET status='trial',   trial_ends_at = now() + interval '14 days' WHERE status='pending';
UPDATE entitlements SET status='expired', trial_ends_at = now()                        WHERE status='suspended';
-- status='active' rows: leave status, trial_ends_at stays null
```

Dev DB can be reset freely — no need to preserve rows there. The migration above is written to be safe on any environment regardless.

## Testing

- Unit: `queries.lookupEntitlementStatus` returns `trial`, `active`, `expired`, `none` correctly (drop `pending`, `suspended`).
- Unit: new `queries.createTrialEntitlement` inserts row with `trialEndsAt = now() + 14 days`.
- Unit: new `queries.expireEntitlement` flips `trial` → `expired`.
- Integration: middleware redirect matrix
  - trial + not-expired → allows `/agent`
  - trial + expired → flips to expired, redirects to `/trial-expired`, logs audit
  - expired → redirects to `/trial-expired`
  - active → allows
  - no row → redirects to `/onboarding/org-type`
  - no orgType (metadata missing) → redirects to `/onboarding/org-type`
- Integration: `/onboarding/org-type` server action writes orgType + creates entitlement + redirects to `/agent`.
- Manual: sign up fresh account, complete both onboarding steps, land on `/agent` with trial active. Manually set `trial_ends_at = now() - interval '1 day'` in DB, refresh, confirm redirect to `/trial-expired` and audit log entry.

## Open risks

- If a user's Clerk org is deleted externally, their entitlement row is orphaned. Harmless (no one can sign in to that org), but leaves stale data. Could prune via Clerk webhook later; out of scope.
- Lazy `trial → expired` write happens inside middleware. If the UPDATE fails the request still needs to respond sensibly — must log the error and fall back to the redirect anyway (don't 500).
