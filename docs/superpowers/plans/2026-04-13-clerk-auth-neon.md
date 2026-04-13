# Clerk Auth + Neon Entitlements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Clerk auth with Municipality vs. Business organizations, a super-admin-approved entitlement gate, and a minimal audit log, backed by Neon Postgres via Drizzle.

**Architecture:** Clerk owns identity + orgs. Neon owns entitlements, session ownership, audit log. Anthropic owns session history. A Next.js 16 `proxy.ts` performs the optimistic entitlement check; server components/actions re-verify. Super-admin approves via `/admin`.

**Tech Stack:** Next.js 16.2 (App Router, React 19), Clerk (`@clerk/nextjs`), Drizzle ORM, Neon serverless Postgres (`@neondatabase/serverless` Pool), `bun test` + PGlite for DB tests, Vercel deployment, TypeScript 5.

**Important environment notes:**

- Next.js 16 **renamed `middleware.ts` to `proxy.ts`** and moved it to Node.js runtime. Use `proxy.ts` at project root.
- The project uses Bun (`bun.lock` present). Scripts use `bun` and `bunx`.
- Per `AGENTS.md`: Next.js 16 APIs may differ from training data. When in doubt, consult `node_modules/next/dist/docs/` before writing code.
- When any Clerk example below does not compile, check the currently installed `@clerk/nextjs` via `node_modules/@clerk/nextjs/README.md` and its `dist/types/` entries. Prefer installed-version examples over training-era examples.

---

## File Structure

### New files (in order of creation)

| File | Responsibility |
|------|----------------|
| `drizzle.config.ts` | drizzle-kit config: dialect postgresql, schema path, out dir, snake_case casing |
| `lib/db/schema.ts` | Three tables: `entitlements`, `session_ownership`, `audit_log` |
| `lib/db/index.ts` | Drizzle client (neon-serverless Pool) + schema barrel |
| `lib/db/test-helpers.ts` | PGlite-backed test DB factory (apply migrations, return Drizzle client, reset) |
| `lib/db/queries.ts` | `lookupEntitlementStatus`, `upsertPendingEntitlement`, `approveEntitlement`, `suspendEntitlement`, `listEntitlements`, `recordSessionOwnership`, `getSessionOwnership` |
| `lib/audit.ts` | `logEvent({ actorUserId, actorOrgId, event, subjectType?, subjectId? })` |
| `lib/auth.ts` | `getCurrentContext()`, `requireActive()`, `requireSuperadmin()` |
| `proxy.ts` | Clerk `clerkMiddleware` + entitlement gate |
| `app/sign-in/[[...sign-in]]/page.tsx` | Clerk `<SignIn />` |
| `app/sign-up/[[...sign-up]]/page.tsx` | Clerk `<SignUp />` |
| `app/onboarding/page.tsx` | "Create org or join existing" screen |
| `app/onboarding/actions.ts` | `createOrgWithType` server action |
| `app/pending/page.tsx` | "Waiting for approval" screen |
| `app/admin/layout.tsx` | `requireSuperadmin()` layout gate |
| `app/admin/page.tsx` | Entitlements table (pending-first) with Clerk org data |
| `app/admin/actions.ts` | `approveOrg`, `suspendOrg` server actions |
| `vitest.config.ts` — _skipped; using `bun test`_ | — |

### Modified files

| File | Change |
|------|--------|
| `package.json` | Add deps: `@clerk/nextjs`, `drizzle-orm`, `@neondatabase/serverless`. Dev deps: `drizzle-kit`, `@electric-sql/pglite`. Scripts: `db:generate`, `db:migrate`, `db:studio`, `test`. |
| `app/layout.tsx` | Wrap children in `<ClerkProvider>` |
| `lib/agent-manager.ts` | `createSession` accepts `{ clerkOrgId, clerkUserId }`; inserts session_ownership; passes metadata to Anthropic |
| `app/api/chat/route.ts` | Auth via `auth()`; 403 on org mismatch; write audit events; pass IDs into `createSession` |
| `app/api/session/[sessionId]/route.ts` | Auth gate: 403 if requester's org ≠ session's org |
| `.env.local` (dev) | Clerk + Neon env vars (template supplied) |
| `.gitignore` | Add `.env.local`, `drizzle/` if not already |

---

## Test Strategy

- **Unit + DB tests** (`bun test`): pure logic in `lib/db/queries.ts`, `lib/audit.ts`, `lib/auth.ts` helpers. DB tests use `@electric-sql/pglite` — an in-process Postgres via WASM — with Drizzle's `drizzle-orm/pglite` adapter. Fast, no external dependencies, works with Bun.
- **Manual smoke tests**: proxy gating, onboarding flow, admin approval flow, chat-with-auth. Documented as a checklist in Task 20.
- Integration tests against real Neon are out of scope for MVP.

---

## Task 1: Install packages and define env vars

**Files:**
- Modify: `package.json`
- Create: `.env.local.example` (template for local dev)
- Modify: `.gitignore`

- [ ] **Step 1: Install runtime and dev packages**

```bash
bun add @clerk/nextjs drizzle-orm @neondatabase/serverless
bun add -d drizzle-kit @electric-sql/pglite
```

- [ ] **Step 2: Add scripts to `package.json`**

Open `package.json`. Inside `"scripts"`, add (merge with existing — do not remove `dev`/`build`/`start`/`lint`):

```json
"db:generate": "drizzle-kit generate",
"db:migrate":  "drizzle-kit migrate",
"db:studio":   "drizzle-kit studio",
"test":        "bun test"
```

- [ ] **Step 3: Create `.env.local.example`**

Create `.env.local.example` at the project root:

```
# Clerk — https://dashboard.clerk.com/
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxx
CLERK_SECRET_KEY=sk_test_xxx
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/onboarding

# Neon — https://console.neon.tech/
DATABASE_URL=postgres://user:pass@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require

# Anthropic (existing)
ANTHROPIC_API_KEY=sk-ant-xxx
```

- [ ] **Step 4: Ensure `.gitignore` excludes `.env.local`**

Open `.gitignore`. Ensure these lines exist (append if missing):

```
.env.local
.env*.local
```

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock .env.local.example .gitignore
git commit -m "chore: install clerk, drizzle, neon driver; add env template"
```

---

## Task 2: Create Drizzle schema

**Files:**
- Create: `lib/db/schema.ts`
- Create: `drizzle.config.ts`

- [ ] **Step 1: Write `lib/db/schema.ts`**

```ts
import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigserial,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const entitlements = pgTable(
  "entitlements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clerkOrgId: text("clerk_org_id").notNull(),
    status: text("status").notNull(), // 'pending' | 'active' | 'suspended'
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
    approvedBy: text("approved_by"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    clerkOrgIdx: uniqueIndex("entitlements_clerk_org_id_idx").on(t.clerkOrgId),
  }),
);

export const sessionOwnership = pgTable(
  "session_ownership",
  {
    anthropicSessionId: text("anthropic_session_id").primaryKey(),
    clerkOrgId: text("clerk_org_id").notNull(),
    clerkUserId: text("clerk_user_id").notNull(),
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
    archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
  },
  (t) => ({
    orgCreatedIdx: index("session_ownership_org_created_idx").on(
      t.clerkOrgId,
      t.createdAt,
    ),
  }),
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    actorUserId: text("actor_user_id").notNull(),
    actorOrgId: text("actor_org_id"),
    event: text("event").notNull(),
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    actorOrgCreatedIdx: index("audit_log_actor_org_created_idx").on(
      t.actorOrgId,
      t.createdAt,
    ),
    actorUserCreatedIdx: index("audit_log_actor_user_created_idx").on(
      t.actorUserId,
      t.createdAt,
    ),
  }),
);

export type Entitlement = typeof entitlements.$inferSelect;
export type NewEntitlement = typeof entitlements.$inferInsert;
export type SessionOwnership = typeof sessionOwnership.$inferSelect;
export type AuditEvent =
  | "user.signed_in"
  | "session.created"
  | "session.opened"
  | "entitlement.approved"
  | "entitlement.suspended";
```

- [ ] **Step 2: Write `drizzle.config.ts`**

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

- [ ] **Step 3: Generate the initial migration**

```bash
bunx drizzle-kit generate --name init_entitlements
```

Expected: a new file in `drizzle/0000_xxx.sql` containing `CREATE TABLE` statements for all three tables, plus `drizzle/meta/_journal.json` and `drizzle/meta/0000_snapshot.json`.

- [ ] **Step 4: Inspect the generated SQL**

```bash
cat drizzle/0000_*.sql
```

Expected: three `CREATE TABLE` statements, one unique index, three plain indexes. Ensure `clerk_org_id` is `text NOT NULL` everywhere, `status` is `text NOT NULL`, and `created_at`/`updated_at` default to `now()`.

- [ ] **Step 5: Commit**

```bash
git add lib/db/schema.ts drizzle.config.ts drizzle/
git commit -m "feat(db): add entitlements, session_ownership, audit_log schema"
```

---

## Task 3: Create Drizzle client and test helpers

**Files:**
- Create: `lib/db/index.ts`
- Create: `lib/db/test-helpers.ts`

- [ ] **Step 1: Write `lib/db/index.ts`**

```ts
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import * as schema from "./schema";

if (typeof window === "undefined" && !neonConfig.webSocketConstructor) {
  neonConfig.webSocketConstructor = ws;
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });

export const db = drizzle(pool, { schema });
export * from "./schema";
```

- [ ] **Step 2: Install `ws` (runtime dep for WebSocket in Node)**

```bash
bun add ws
bun add -d @types/ws
```

- [ ] **Step 3: Write `lib/db/test-helpers.ts`**

```ts
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import * as schema from "./schema";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

export async function createTestDb(): Promise<{ db: TestDb; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });

  // Apply all generated migrations in order
  const migrationsDir = join(process.cwd(), "drizzle");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const rawSql = readFileSync(join(migrationsDir, file), "utf8");
    // drizzle-kit emits statement-breakpoint comments; split on them
    const statements = rawSql
      .split(/--\s*>\s*statement-breakpoint/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const stmt of statements) {
      await db.execute(sql.raw(stmt));
    }
  }

  return {
    db,
    close: async () => {
      await client.close();
    },
  };
}
```

- [ ] **Step 4: Install the pglite Drizzle adapter import path**

The `drizzle-orm/pglite` subpath ships with `drizzle-orm`; no additional install. Verify with:

```bash
ls node_modules/drizzle-orm/pglite
```

Expected: directory exists with `index.js`, `index.d.ts`.

- [ ] **Step 5: Write a smoke test to verify PGlite + Drizzle work**

Create `lib/db/test-helpers.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { createTestDb, type TestDb } from "./test-helpers";
import { entitlements } from "./schema";

describe("createTestDb", () => {
  it("creates tables and allows inserts", async () => {
    const { db, close } = await createTestDb();
    try {
      await db.insert(entitlements).values({
        clerkOrgId: "org_test",
        status: "pending",
      });
      const rows = await db.select().from(entitlements);
      expect(rows).toHaveLength(1);
      expect(rows[0].clerkOrgId).toBe("org_test");
      expect(rows[0].status).toBe("pending");
    } finally {
      await close();
    }
  });
});
```

- [ ] **Step 6: Run the smoke test**

```bash
bun test lib/db/test-helpers.test.ts
```

Expected: 1 pass.

- [ ] **Step 7: Commit**

```bash
git add lib/db/index.ts lib/db/test-helpers.ts lib/db/test-helpers.test.ts package.json bun.lock
git commit -m "feat(db): add drizzle client and pglite-based test helper"
```

---

## Task 4: Write `lib/db/queries.ts` — entitlement functions (TDD)

**Files:**
- Create: `lib/db/queries.test.ts`
- Create: `lib/db/queries.ts`

- [ ] **Step 1: Write failing tests for entitlement queries**

Create `lib/db/queries.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTestDb, type TestDb } from "./test-helpers";
import {
  makeQueries,
  type EntitlementStatus,
} from "./queries";

let testDb: { db: TestDb; close: () => Promise<void> };
let q: ReturnType<typeof makeQueries>;

beforeEach(async () => {
  testDb = await createTestDb();
  q = makeQueries(testDb.db);
});

afterEach(async () => {
  await testDb.close();
});

describe("lookupEntitlementStatus", () => {
  it("returns 'none' when no row exists", async () => {
    expect(await q.lookupEntitlementStatus("org_missing")).toBe("none");
  });

  it("returns the row's status when present", async () => {
    await q.upsertPendingEntitlement("org_a");
    expect(await q.lookupEntitlementStatus("org_a")).toBe("pending");
  });
});

describe("upsertPendingEntitlement", () => {
  it("creates a pending row on first call", async () => {
    await q.upsertPendingEntitlement("org_a");
    expect(await q.lookupEntitlementStatus("org_a")).toBe("pending");
  });

  it("is idempotent — does not downgrade an active row", async () => {
    await q.upsertPendingEntitlement("org_a");
    await q.approveEntitlement({
      clerkOrgId: "org_a",
      approvedBy: "user_admin",
    });
    await q.upsertPendingEntitlement("org_a");
    expect(await q.lookupEntitlementStatus("org_a")).toBe("active");
  });
});

describe("approveEntitlement", () => {
  it("transitions pending → active", async () => {
    await q.upsertPendingEntitlement("org_a");
    await q.approveEntitlement({
      clerkOrgId: "org_a",
      approvedBy: "user_admin",
    });
    expect(await q.lookupEntitlementStatus("org_a")).toBe("active");
  });

  it("sets approvedBy and approvedAt", async () => {
    await q.upsertPendingEntitlement("org_a");
    const before = new Date();
    await q.approveEntitlement({
      clerkOrgId: "org_a",
      approvedBy: "user_admin",
    });
    const row = await q.getEntitlement("org_a");
    expect(row?.approvedBy).toBe("user_admin");
    expect(row?.approvedAt).toBeInstanceOf(Date);
    expect(row!.approvedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 10);
  });
});

describe("suspendEntitlement", () => {
  it("transitions active → suspended and stores notes", async () => {
    await q.upsertPendingEntitlement("org_a");
    await q.approveEntitlement({ clerkOrgId: "org_a", approvedBy: "user_admin" });
    await q.suspendEntitlement({
      clerkOrgId: "org_a",
      notes: "non-payment",
    });
    expect(await q.lookupEntitlementStatus("org_a")).toBe("suspended");
    const row = await q.getEntitlement("org_a");
    expect(row?.notes).toBe("non-payment");
  });
});

describe("listEntitlements", () => {
  it("returns pending rows before active rows", async () => {
    await q.upsertPendingEntitlement("org_pending");
    await q.upsertPendingEntitlement("org_active");
    await q.approveEntitlement({ clerkOrgId: "org_active", approvedBy: "u" });
    const rows = await q.listEntitlements();
    expect(rows.map((r) => r.clerkOrgId)).toEqual(["org_pending", "org_active"]);
  });
});

describe("recordSessionOwnership + getSessionOwnership", () => {
  it("stores and retrieves ownership", async () => {
    await q.recordSessionOwnership({
      anthropicSessionId: "sess_1",
      clerkOrgId: "org_a",
      clerkUserId: "user_1",
    });
    const row = await q.getSessionOwnership("sess_1");
    expect(row?.clerkOrgId).toBe("org_a");
    expect(row?.clerkUserId).toBe("user_1");
  });

  it("returns null for unknown session", async () => {
    expect(await q.getSessionOwnership("sess_missing")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test lib/db/queries.test.ts
```

Expected: all fail with "Cannot find module './queries'" or equivalent.

- [ ] **Step 3: Implement `lib/db/queries.ts`**

```ts
import { eq, asc, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { entitlements, sessionOwnership } from "./schema";

export type EntitlementStatus = "none" | "pending" | "active" | "suspended";

// The common Postgres Drizzle base: accepts node-postgres, neon-serverless,
// pglite, AND transactions from any of them.
type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>;

export function makeQueries(db: AnyDb) {
  return {
    async lookupEntitlementStatus(clerkOrgId: string): Promise<EntitlementStatus> {
      const [row] = await db
        .select({ status: entitlements.status })
        .from(entitlements)
        .where(eq(entitlements.clerkOrgId, clerkOrgId))
        .limit(1);
      if (!row) return "none";
      return row.status as EntitlementStatus;
    },

    async getEntitlement(clerkOrgId: string) {
      const [row] = await db
        .select()
        .from(entitlements)
        .where(eq(entitlements.clerkOrgId, clerkOrgId))
        .limit(1);
      return row ?? null;
    },

    async upsertPendingEntitlement(clerkOrgId: string) {
      await db
        .insert(entitlements)
        .values({ clerkOrgId, status: "pending" })
        .onConflictDoNothing({ target: entitlements.clerkOrgId });
    },

    async approveEntitlement(params: {
      clerkOrgId: string;
      approvedBy: string;
    }) {
      await db
        .update(entitlements)
        .set({
          status: "active",
          approvedAt: new Date(),
          approvedBy: params.approvedBy,
          updatedAt: new Date(),
        })
        .where(eq(entitlements.clerkOrgId, params.clerkOrgId));
    },

    async suspendEntitlement(params: { clerkOrgId: string; notes: string }) {
      await db
        .update(entitlements)
        .set({
          status: "suspended",
          notes: params.notes,
          updatedAt: new Date(),
        })
        .where(eq(entitlements.clerkOrgId, params.clerkOrgId));
    },

    async listEntitlements() {
      // Pending first, then active, then suspended; within each, oldest-created first
      return db
        .select()
        .from(entitlements)
        .orderBy(
          sql`case ${entitlements.status}
              when 'pending' then 0
              when 'active'  then 1
              when 'suspended' then 2
              else 3 end`,
          asc(entitlements.createdAt),
        );
    },

    async recordSessionOwnership(params: {
      anthropicSessionId: string;
      clerkOrgId: string;
      clerkUserId: string;
      title?: string;
    }) {
      await db.insert(sessionOwnership).values({
        anthropicSessionId: params.anthropicSessionId,
        clerkOrgId: params.clerkOrgId,
        clerkUserId: params.clerkUserId,
        title: params.title ?? null,
      });
    },

    async getSessionOwnership(anthropicSessionId: string) {
      const [row] = await db
        .select()
        .from(sessionOwnership)
        .where(eq(sessionOwnership.anthropicSessionId, anthropicSessionId))
        .limit(1);
      return row ?? null;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test lib/db/queries.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/db/queries.ts lib/db/queries.test.ts
git commit -m "feat(db): add entitlement and ownership queries with tests"
```

---

## Task 5: Write `lib/audit.ts` — audit log writer (TDD)

**Files:**
- Create: `lib/audit.test.ts`
- Create: `lib/audit.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/audit.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createTestDb, type TestDb } from "./db/test-helpers";
import { auditLog } from "./db/schema";
import { makeAudit } from "./audit";

let testDb: { db: TestDb; close: () => Promise<void> };
let audit: ReturnType<typeof makeAudit>;

beforeEach(async () => {
  testDb = await createTestDb();
  audit = makeAudit(testDb.db);
});

afterEach(async () => {
  await testDb.close();
});

describe("logEvent", () => {
  it("inserts a row with required fields", async () => {
    await audit.logEvent({
      actorUserId: "user_1",
      actorOrgId: "org_1",
      event: "session.created",
      subjectType: "session",
      subjectId: "sess_1",
    });

    const rows = await testDb.db.select().from(auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0].actorUserId).toBe("user_1");
    expect(rows[0].actorOrgId).toBe("org_1");
    expect(rows[0].event).toBe("session.created");
    expect(rows[0].subjectType).toBe("session");
    expect(rows[0].subjectId).toBe("sess_1");
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });

  it("allows null actorOrgId for super-admin actions", async () => {
    await audit.logEvent({
      actorUserId: "user_admin",
      actorOrgId: null,
      event: "entitlement.approved",
      subjectType: "entitlement",
      subjectId: "org_x",
    });
    const rows = await testDb.db.select().from(auditLog);
    expect(rows[0].actorOrgId).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test lib/audit.test.ts
```

Expected: fail on missing module.

- [ ] **Step 3: Implement `lib/audit.ts`**

```ts
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./db/schema";
import { auditLog, type AuditEvent } from "./db/schema";

type AnyDb = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface AuditEntry {
  actorUserId: string;
  actorOrgId: string | null;
  event: AuditEvent;
  subjectType?: "session" | "entitlement" | null;
  subjectId?: string | null;
}

export function makeAudit(db: AnyDb) {
  return {
    async logEvent(entry: AuditEntry): Promise<void> {
      await db.insert(auditLog).values({
        actorUserId: entry.actorUserId,
        actorOrgId: entry.actorOrgId,
        event: entry.event,
        subjectType: entry.subjectType ?? null,
        subjectId: entry.subjectId ?? null,
      });
    },
  };
}

// Convenience singleton bound to the production db
import { db } from "./db";
export const audit = makeAudit(db);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test lib/audit.test.ts
```

Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/audit.ts lib/audit.test.ts
git commit -m "feat(audit): add minimal audit log writer with tests"
```

---

## Task 6: Write `lib/auth.ts` — context helpers (TDD for pure logic)

**Files:**
- Create: `lib/auth.test.ts`
- Create: `lib/auth.ts`

This file has two parts: pure logic (the error classes, superadmin predicate) that we test, and Clerk-bound helpers (`getCurrentContext`) that we smoke test manually.

- [ ] **Step 1: Write failing test for the superadmin predicate**

Create `lib/auth.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { isSuperadmin, NotSuperadminError, NotActiveError } from "./auth";

describe("isSuperadmin", () => {
  it("returns true when publicMetadata.role === 'superadmin'", () => {
    expect(isSuperadmin({ role: "superadmin" })).toBe(true);
  });

  it("returns false for other roles", () => {
    expect(isSuperadmin({ role: "member" })).toBe(false);
    expect(isSuperadmin({ role: undefined })).toBe(false);
    expect(isSuperadmin({})).toBe(false);
    expect(isSuperadmin(null)).toBe(false);
    expect(isSuperadmin(undefined)).toBe(false);
  });
});

describe("error classes", () => {
  it("NotSuperadminError is an Error subclass", () => {
    const e = new NotSuperadminError();
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toContain("superadmin");
  });

  it("NotActiveError carries a status string", () => {
    const e = new NotActiveError("pending");
    expect(e.status).toBe("pending");
    expect(e).toBeInstanceOf(Error);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test lib/auth.test.ts
```

Expected: fail on missing module.

- [ ] **Step 3: Implement `lib/auth.ts`**

```ts
import { auth } from "@clerk/nextjs/server";
import { makeQueries } from "./db/queries";
import { db } from "./db";

export class NotSuperadminError extends Error {
  constructor() {
    super("Caller is not a superadmin");
    this.name = "NotSuperadminError";
  }
}

export class NotActiveError extends Error {
  constructor(public readonly status: "none" | "pending" | "suspended") {
    super(`Caller org is not active (status: ${status})`);
    this.name = "NotActiveError";
  }
}

export class NotAuthenticatedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "NotAuthenticatedError";
  }
}

export class NoOrgError extends Error {
  constructor() {
    super("No active organization");
    this.name = "NoOrgError";
  }
}

export function isSuperadmin(
  publicMetadata: Record<string, unknown> | null | undefined,
): boolean {
  if (!publicMetadata) return false;
  return publicMetadata.role === "superadmin";
}

const queries = makeQueries(db);

export interface CurrentContext {
  userId: string;
  orgId: string;
}

/**
 * Returns the current user and active org. Throws if unauthenticated or no org.
 */
export async function getCurrentContext(): Promise<CurrentContext> {
  const { userId, orgId } = await auth();
  if (!userId) throw new NotAuthenticatedError();
  if (!orgId) throw new NoOrgError();
  return { userId, orgId };
}

/**
 * Asserts the caller is authenticated, has an active org, and the org's
 * entitlement is 'active'. Returns the context.
 */
export async function requireActive(): Promise<CurrentContext> {
  const ctx = await getCurrentContext();
  const status = await queries.lookupEntitlementStatus(ctx.orgId);
  if (status !== "active") {
    throw new NotActiveError(status);
  }
  return ctx;
}

/**
 * Asserts the caller is a superadmin. Throws NotSuperadminError otherwise.
 */
export async function requireSuperadmin(): Promise<{ userId: string }> {
  const { userId, sessionClaims } = await auth();
  if (!userId) throw new NotAuthenticatedError();
  const publicMetadata = (sessionClaims?.publicMetadata ?? {}) as Record<
    string,
    unknown
  >;
  if (!isSuperadmin(publicMetadata)) throw new NotSuperadminError();
  return { userId };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test lib/auth.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts lib/auth.test.ts
git commit -m "feat(auth): add context helpers (requireActive, requireSuperadmin)"
```

---

## Task 7: Set up Clerk provider in root layout

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Step 1: Update `app/layout.tsx` to wrap in `<ClerkProvider>`**

Replace the existing `RootLayout` default export body. The final file:

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { cn } from "@/lib/utils";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Boetta",
  description: "Byggesaksvurdering",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={cn(
          "h-full",
          "antialiased",
          geistSans.variable,
          geistMono.variable,
          "font-sans",
          inter.variable,
        )}
      >
        <body className="min-h-full flex flex-col">{children}</body>
      </html>
    </ClerkProvider>
  );
}
```

- [ ] **Step 2: Verify the app still compiles**

```bash
bun run build
```

Expected: build succeeds. If Clerk complains about missing env vars during build, that's expected — set them in `.env.local` following `.env.local.example` before running. If build fails on something else, stop and diagnose.

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx
git commit -m "feat(auth): wrap root layout in ClerkProvider"
```

---

## Task 8: Add Clerk sign-in / sign-up catch-all pages

**Files:**
- Create: `app/sign-in/[[...sign-in]]/page.tsx`
- Create: `app/sign-up/[[...sign-up]]/page.tsx`

- [ ] **Step 1: Create the sign-in page**

```tsx
// app/sign-in/[[...sign-in]]/page.tsx
import { SignIn } from "@clerk/nextjs";

export default function Page() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <SignIn />
    </div>
  );
}
```

- [ ] **Step 2: Create the sign-up page**

```tsx
// app/sign-up/[[...sign-up]]/page.tsx
import { SignUp } from "@clerk/nextjs";

export default function Page() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <SignUp />
    </div>
  );
}
```

- [ ] **Step 3: Manual smoke test**

```bash
bun run dev
```

Visit `http://localhost:3000/sign-in` and `http://localhost:3000/sign-up`. Both should render Clerk's UI. Kill dev server with Ctrl-C.

- [ ] **Step 4: Commit**

```bash
git add app/sign-in app/sign-up
git commit -m "feat(auth): add clerk sign-in and sign-up pages"
```

---

## Task 9: Create `proxy.ts` with auth gate (no entitlement check yet)

**Files:**
- Create: `proxy.ts`

This task adds Clerk auth protection only; the entitlement check is layered in Task 12.

- [ ] **Step 1: Create `proxy.ts` at the project root**

```ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;

  const { isAuthenticated, redirectToSignIn } = await auth();
  if (!isAuthenticated) {
    return redirectToSignIn();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
```

**Note for Next.js 16:** The file must be named `proxy.ts` (not `middleware.ts`). Clerk's `clerkMiddleware()` export name is historical and works with Next 16's proxy. If Clerk has released a Next-16-specific export (e.g., `clerkProxy`) by the time you implement this, prefer that. Check `node_modules/@clerk/nextjs/dist/types/server/index.d.ts` for current exports.

- [ ] **Step 2: Manual smoke test**

```bash
bun run dev
```

- Visit `/` unauthenticated → should redirect to `/sign-in`.
- Visit `/sign-in` → should render without redirect.
- Sign in → should land back on `/` (or `/onboarding` if `AFTER_SIGN_IN_URL` takes precedence).

Kill dev server.

- [ ] **Step 3: Commit**

```bash
git add proxy.ts
git commit -m "feat(auth): add clerk proxy with sign-in gate"
```

---

## Task 10: Build the onboarding flow

**Files:**
- Create: `app/onboarding/page.tsx`
- Create: `app/onboarding/actions.ts`

- [ ] **Step 1: Implement `app/onboarding/actions.ts`**

```ts
"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { makeQueries } from "@/lib/db/queries";
import { db } from "@/lib/db";

const queries = makeQueries(db);

export async function createOrgWithType(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const orgType = String(formData.get("orgType") ?? "");

  if (!name) throw new Error("Name is required");
  if (orgType !== "municipality" && orgType !== "business") {
    throw new Error("orgType must be 'municipality' or 'business'");
  }

  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  const client = await clerkClient();

  const org = await client.organizations.createOrganization({
    name,
    createdBy: userId,
    publicMetadata: { orgType },
  });

  // Upsert a pending entitlement for the new org
  await queries.upsertPendingEntitlement(org.id);

  // Activate the new org on the user's session so subsequent requests pick it up.
  // Clerk updates the session claim on next cookie round-trip; the redirect below
  // triggers that round-trip.
  redirect("/pending");
}
```

- [ ] **Step 2: Implement `app/onboarding/page.tsx`**

```tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { createOrgWithType } from "./actions";

export default async function OnboardingPage() {
  const { userId, orgId } = await auth();
  if (!userId) redirect("/sign-in");

  if (orgId) {
    // Already in an org; skip onboarding
    redirect("/");
  }

  return (
    <div className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold mb-4">Velkommen til Boetta</h1>
      <p className="mb-6 text-sm text-gray-600">
        Opprett organisasjonen din for å komme i gang. En administrator godkjenner
        tilgang før du kan bruke applikasjonen.
      </p>

      <form action={createOrgWithType} className="space-y-4">
        <label className="block">
          <span className="block text-sm font-medium mb-1">Navn</span>
          <input
            name="name"
            required
            className="w-full rounded border px-3 py-2"
            placeholder="Oslo kommune / Acme Arkitekter AS"
          />
        </label>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Type organisasjon</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="orgType" value="municipality" required />
            <span>Kommune</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="orgType" value="business" />
            <span>Bedrift</span>
          </label>
        </fieldset>

        <button
          type="submit"
          className="rounded bg-black text-white px-4 py-2"
        >
          Opprett organisasjon
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/onboarding
git commit -m "feat(onboarding): create-org page and server action with pending entitlement"
```

---

## Task 11: Build the `/pending` page

**Files:**
- Create: `app/pending/page.tsx`

- [ ] **Step 1: Implement the page**

```tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { makeQueries } from "@/lib/db/queries";
import { db } from "@/lib/db";
import { SignOutButton } from "@clerk/nextjs";

const queries = makeQueries(db);

export default async function PendingPage() {
  const { userId, orgId } = await auth();
  if (!userId) redirect("/sign-in");
  if (!orgId) redirect("/onboarding");

  // Ensure an entitlement row exists even if the user arrived via a direct link
  await queries.upsertPendingEntitlement(orgId);
  const status = await queries.lookupEntitlementStatus(orgId);

  if (status === "active") redirect("/");

  return (
    <div className="mx-auto max-w-xl p-8 text-center">
      <h1 className="text-2xl font-semibold mb-4">Venter på godkjenning</h1>
      <p className="text-gray-600 mb-6">
        Organisasjonen din er registrert. En administrator vil godkjenne
        tilgangen snart. Du kan lukke denne siden og komme tilbake senere.
      </p>
      {status === "suspended" && (
        <p className="text-red-600 mb-4">
          Tilgangen er midlertidig suspendert. Kontakt support for mer
          informasjon.
        </p>
      )}
      <SignOutButton>
        <button className="underline text-sm">Logg ut</button>
      </SignOutButton>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/pending
git commit -m "feat(onboarding): add pending-approval screen"
```

---

## Task 12: Extend proxy with entitlement gate

**Files:**
- Modify: `proxy.ts`

- [ ] **Step 1: Replace the proxy body with the full gate logic**

Full file content:

```ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { makeQueries } from "@/lib/db/queries";
import { db } from "@/lib/db";

const queries = makeQueries(db);

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
]);

const isOnboardingRoute = createRouteMatcher(["/onboarding(.*)"]);
const isPendingRoute = createRouteMatcher(["/pending(.*)"]);
const isAdminRoute = createRouteMatcher(["/admin(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;

  const { isAuthenticated, userId, orgId, redirectToSignIn } = await auth();
  if (!isAuthenticated) return redirectToSignIn();

  // Super-admin surface and sign-out live above the gate
  if (isAdminRoute(req)) return;

  // Onboarding allowed when there's no active org
  if (!orgId) {
    if (isOnboardingRoute(req)) return;
    return NextResponse.redirect(new URL("/onboarding", req.url));
  }

  // Pending page is allowed for any auth'd user with an org (regardless of status)
  if (isPendingRoute(req)) return;

  // Entitlement check
  let status: "none" | "pending" | "active" | "suspended";
  try {
    status = await queries.lookupEntitlementStatus(orgId);
  } catch (err) {
    console.error("[proxy] entitlement lookup failed", err);
    return new NextResponse("Service unavailable", { status: 503 });
  }

  if (status !== "active") {
    return NextResponse.redirect(new URL("/pending", req.url));
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
```

- [ ] **Step 2: Manual smoke test**

```bash
bun run dev
```

Smoke-test matrix (perform each and observe):

1. Unauth'd → `/` → redirects to `/sign-in` ✓
2. Signed in, no org → `/` → redirects to `/onboarding` ✓
3. Onboarding form submit with orgType=municipality → redirects to `/pending`, Neon `entitlements` row exists with `status='pending'`, Clerk org exists with `publicMetadata.orgType='municipality'` ✓
4. Signed in, pending → `/` → redirects to `/pending` ✓
5. Suspended (manually set via `UPDATE entitlements SET status='suspended' WHERE clerk_org_id='…'` in Neon) → `/` → redirects to `/pending` with "suspended" banner ✓

- [ ] **Step 3: Commit**

```bash
git add proxy.ts
git commit -m "feat(auth): gate all app routes on org entitlement status"
```

---

## Task 13: Super-admin layout

**Files:**
- Create: `app/admin/layout.tsx`

- [ ] **Step 1: Implement the layout with superadmin gate**

```tsx
import { redirect } from "next/navigation";
import { requireSuperadmin } from "@/lib/auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await requireSuperadmin();
  } catch {
    redirect("/");
  }

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold mb-6">Admin — Godkjenninger</h1>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/admin/layout.tsx
git commit -m "feat(admin): gate /admin layout on superadmin role"
```

---

## Task 14: Admin page — entitlements table

**Files:**
- Create: `app/admin/page.tsx`

- [ ] **Step 1: Implement the page**

```tsx
import { clerkClient } from "@clerk/nextjs/server";
import { makeQueries } from "@/lib/db/queries";
import { db } from "@/lib/db";
import { approveOrg, suspendOrg } from "./actions";

const queries = makeQueries(db);

export default async function AdminPage() {
  const rows = await queries.listEntitlements();
  const client = await clerkClient();

  // Fetch Clerk org details in parallel
  const orgs = await Promise.all(
    rows.map(async (r) => {
      try {
        const org = await client.organizations.getOrganization({
          organizationId: r.clerkOrgId,
        });
        const orgType =
          (org.publicMetadata?.orgType as string | undefined) ?? "—";
        return { ...r, name: org.name, orgType };
      } catch {
        return { ...r, name: "(unknown)", orgType: "—" };
      }
    }),
  );

  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="text-left border-b">
          <th className="py-2">Org</th>
          <th>Type</th>
          <th>Status</th>
          <th>Opprettet</th>
          <th>Handling</th>
        </tr>
      </thead>
      <tbody>
        {orgs.map((o) => (
          <tr key={o.clerkOrgId} className="border-b align-top">
            <td className="py-2">
              <div className="font-medium">{o.name}</div>
              <div className="text-xs text-gray-500">{o.clerkOrgId}</div>
            </td>
            <td>{o.orgType}</td>
            <td>{o.status}</td>
            <td>{o.createdAt.toISOString().slice(0, 10)}</td>
            <td>
              <div className="flex gap-2 items-start">
                {o.status !== "active" && (
                  <form action={approveOrg}>
                    <input
                      type="hidden"
                      name="clerkOrgId"
                      value={o.clerkOrgId}
                    />
                    <select name="orgType" defaultValue={o.orgType} className="border px-1 text-xs">
                      <option value="municipality">municipality</option>
                      <option value="business">business</option>
                    </select>
                    <button className="ml-2 px-2 py-1 bg-green-700 text-white rounded text-xs">
                      Godkjenn
                    </button>
                  </form>
                )}
                {o.status === "active" && (
                  <form action={suspendOrg}>
                    <input
                      type="hidden"
                      name="clerkOrgId"
                      value={o.clerkOrgId}
                    />
                    <input
                      name="notes"
                      placeholder="Notat"
                      className="border px-2 py-1 text-xs"
                    />
                    <button className="ml-2 px-2 py-1 bg-red-700 text-white rounded text-xs">
                      Suspender
                    </button>
                  </form>
                )}
              </div>
            </td>
          </tr>
        ))}
        {orgs.length === 0 && (
          <tr>
            <td colSpan={5} className="py-8 text-center text-gray-500">
              Ingen organisasjoner ennå.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/admin/page.tsx
git commit -m "feat(admin): render entitlements table with approve/suspend actions"
```

---

## Task 15: Admin actions — approveOrg, suspendOrg

**Files:**
- Create: `app/admin/actions.ts`

- [ ] **Step 1: Implement the server actions**

```ts
"use server";

import { clerkClient } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { makeQueries } from "@/lib/db/queries";
import { makeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { requireSuperadmin } from "@/lib/auth";

const queries = makeQueries(db);
const audit = makeAudit(db);

export async function approveOrg(formData: FormData) {
  const { userId } = await requireSuperadmin();

  const clerkOrgId = String(formData.get("clerkOrgId") ?? "");
  const orgType = String(formData.get("orgType") ?? "");

  if (!clerkOrgId) throw new Error("clerkOrgId required");
  if (orgType !== "municipality" && orgType !== "business") {
    throw new Error("orgType invalid");
  }

  await db.transaction(async (tx) => {
    const txQueries = makeQueries(tx);
    const txAudit = makeAudit(tx);
    await txQueries.approveEntitlement({ clerkOrgId, approvedBy: userId });
    await txAudit.logEvent({
      actorUserId: userId,
      actorOrgId: null,
      event: "entitlement.approved",
      subjectType: "entitlement",
      subjectId: clerkOrgId,
    });
  });

  // Write orgType to Clerk (outside the DB transaction — tolerable partial failure)
  const client = await clerkClient();
  await client.organizations.updateOrganization(clerkOrgId, {
    publicMetadata: { orgType },
  });

  revalidatePath("/admin");
}

export async function suspendOrg(formData: FormData) {
  const { userId } = await requireSuperadmin();
  const clerkOrgId = String(formData.get("clerkOrgId") ?? "");
  const notes = String(formData.get("notes") ?? "").trim() || "manual suspend";

  if (!clerkOrgId) throw new Error("clerkOrgId required");

  await db.transaction(async (tx) => {
    const txQueries = makeQueries(tx);
    const txAudit = makeAudit(tx);
    await txQueries.suspendEntitlement({ clerkOrgId, notes });
    await txAudit.logEvent({
      actorUserId: userId,
      actorOrgId: null,
      event: "entitlement.suspended",
      subjectType: "entitlement",
      subjectId: clerkOrgId,
    });
  });

  revalidatePath("/admin");
}
```

- [ ] **Step 2: Manual smoke test**

Flag your Clerk user as superadmin via the Clerk dashboard: set `publicMetadata = { "role": "superadmin" }` on your user. Sign out and back in so the claim refreshes. Then:

```bash
bun run dev
```

- Visit `/admin` as superadmin → see the pending org you created in Task 12.
- Click "Godkjenn" with orgType=municipality → row flips to active; Neon `audit_log` gets a `entitlement.approved` row; Clerk org `publicMetadata.orgType` is updated.
- Visit `/` as the approved org's member → app is accessible.
- Return to `/admin`, click "Suspender" → row flips to suspended; audit row written; `/` redirects to `/pending` again.
- Visit `/admin` as a non-superadmin user → redirects to `/`.

- [ ] **Step 3: Commit**

```bash
git add app/admin/actions.ts
git commit -m "feat(admin): server actions for approve/suspend with audit log"
```

---

## Task 16: Wire session ownership into `createSession` (TDD where practical)

**Files:**
- Modify: `lib/agent-manager.ts`

This task is a refactor of existing code; the behavior change is "insert a session_ownership row and stamp Anthropic metadata." It is difficult to unit-test without mocking Anthropic; we rely on the manual smoke test in Task 17.

- [ ] **Step 1: Update `createSession` signature and body**

Find `export async function createSession(): Promise<string>` in `lib/agent-manager.ts`. Replace with:

```ts
import { makeQueries } from "@/lib/db/queries";
import { db } from "@/lib/db";

const ownershipQueries = makeQueries(db);

export async function createSession(params: {
  clerkOrgId: string;
  clerkUserId: string;
  title?: string;
}): Promise<string> {
  const [agentId, environmentId] = await Promise.all([
    getAgentId(),
    getEnvironmentId(),
  ]);

  const session = await client.beta.sessions.create({
    agent: agentId,
    environment_id: environmentId,
    metadata: {
      clerkOrgId: params.clerkOrgId,
      clerkUserId: params.clerkUserId,
    },
    ...(params.title ? { title: params.title } : {}),
  });

  await ownershipQueries.recordSessionOwnership({
    anthropicSessionId: session.id,
    clerkOrgId: params.clerkOrgId,
    clerkUserId: params.clerkUserId,
    title: params.title,
  });

  return session.id;
}
```

Keep all other exports (`getAgentId`, `getEnvironmentId`, `streamWithToolHandling`, `buildContentBlocks`) unchanged.

- [ ] **Step 2: Verify the file still type-checks**

```bash
bun run build
```

Expected: build succeeds. TypeScript will flag any callers of `createSession()` that don't pass the new params — the only caller is in `app/api/chat/route.ts`, which Task 17 updates.

- [ ] **Step 3: Commit**

```bash
git add lib/agent-manager.ts
git commit -m "feat(sessions): record ownership and stamp metadata on createSession"
```

---

## Task 17: Update `/api/chat` to authenticate, verify ownership, and audit

**Files:**
- Modify: `app/api/chat/route.ts`

- [ ] **Step 1: Replace the file with the auth-enabled version**

```ts
import {
  createSession,
  streamWithToolHandling,
} from "@/lib/agent-manager";
import { requireActive } from "@/lib/auth";
import { makeQueries } from "@/lib/db/queries";
import { makeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import type { FileUIPart } from "ai";

const queries = makeQueries(db);
const audit = makeAudit(db);

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireActive();
  } catch (err) {
    const status = err instanceof Error && err.name === "NotActiveError" ? 403 : 401;
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unauthorized" }),
      { status, headers: { "Content-Type": "application/json" } },
    );
  }

  const { message, sessionId: existingSessionId, files } =
    (await request.json()) as {
      message: string;
      sessionId?: string;
      files?: FileUIPart[];
    };

  let sessionId = existingSessionId;
  let eventForAudit: "session.created" | "session.opened" = "session.opened";

  if (!sessionId) {
    sessionId = await createSession({
      clerkOrgId: ctx.orgId,
      clerkUserId: ctx.userId,
    });
    eventForAudit = "session.created";
  } else {
    // Verify the caller's org owns this session
    const ownership = await queries.getSessionOwnership(sessionId);
    if (!ownership || ownership.clerkOrgId !== ctx.orgId) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  await audit.logEvent({
    actorUserId: ctx.userId,
    actorOrgId: ctx.orgId,
    event: eventForAudit,
    subjectType: "session",
    subjectId: sessionId,
  });

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of streamWithToolHandling(
          sessionId!,
          message,
          files ?? [],
        )) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
          if (event.type === "done") break;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message: msg })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Session-Id": sessionId,
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "feat(api): auth + ownership check + audit events in /api/chat"
```

---

## Task 18: Update `/api/session/[sessionId]` to enforce ownership

**Files:**
- Modify: `app/api/session/[sessionId]/route.ts`

- [ ] **Step 1: Add an ownership check at the top of `GET`**

Find the `export async function GET(...)` declaration. Insert an auth + ownership check immediately after `const { sessionId } = await params;`:

```ts
import { requireActive } from "@/lib/auth";
import { makeQueries } from "@/lib/db/queries";
import { db } from "@/lib/db";

const queries = makeQueries(db);
```

Add these imports at the top of the file.

Then, inside `GET`, right after `const { sessionId } = await params;`:

```ts
let ctx;
try {
  ctx = await requireActive();
} catch (err) {
  const status = err instanceof Error && err.name === "NotActiveError" ? 403 : 401;
  return Response.json(
    { error: err instanceof Error ? err.message : "Unauthorized" },
    { status },
  );
}

const ownership = await queries.getSessionOwnership(sessionId);
if (!ownership || ownership.clerkOrgId !== ctx.orgId) {
  return Response.json({ error: "Forbidden" }, { status: 403 });
}
```

Leave the rest of the file (`try { ... client.beta.sessions.retrieve(...) ... }`) untouched.

- [ ] **Step 2: Commit**

```bash
git add app/api/session/[sessionId]/route.ts
git commit -m "feat(api): enforce session ownership on GET /api/session/:id"
```

---

## Task 19: Apply migrations to Neon and deploy env setup

**Files:**
- Modify: `package.json` (if not already — verify the `db:migrate` script added in Task 1)

- [ ] **Step 1: Provision a Neon project**

Using the Neon dashboard:
1. Create a project.
2. Create a database (the default `neondb` is fine).
3. Copy the **pooled** connection string (contains `-pooler` in the host) to `.env.local` as `DATABASE_URL`.

- [ ] **Step 2: Run migrations against the dev Neon branch**

```bash
bun run db:migrate
```

Expected output: drizzle-kit applies `drizzle/0000_*.sql` and prints a summary. If it errors, check that `DATABASE_URL` is set and reachable (`psql "$DATABASE_URL" -c 'select 1'`).

- [ ] **Step 3: Verify tables exist**

```bash
psql "$DATABASE_URL" -c "\dt"
```

Expected: three tables (`entitlements`, `session_ownership`, `audit_log`) plus the Drizzle migrations table (`__drizzle_migrations`).

- [ ] **Step 4: Document Vercel env vars**

Create `docs/superpowers/specs/2026-04-13-clerk-auth-neon-vercel-env.md` listing the env vars to set in Vercel project settings:

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
NEXT_PUBLIC_CLERK_SIGN_IN_URL
NEXT_PUBLIC_CLERK_SIGN_UP_URL
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL
DATABASE_URL            # prod pooled connection string from Neon
ANTHROPIC_API_KEY
```

Add a one-liner at the top: "Set via `vercel env add <NAME>` or the Vercel dashboard. Migrations are applied via `bun run db:migrate` locally pointing at the prod DATABASE_URL, or as a post-build step."

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "docs: note vercel env vars for clerk+neon rollout"
```

---

## Task 20: End-to-end manual smoke test

**No files created.** This is a verification checklist. Perform every step on a fresh Neon branch and a fresh Clerk user.

- [ ] **A. Reset state**
  - Truncate Neon tables: `psql "$DATABASE_URL" -c "TRUNCATE entitlements, session_ownership, audit_log RESTART IDENTITY;"`
  - Delete test orgs in Clerk dashboard.
  - Sign out any existing session.

- [ ] **B. New user flow**
  1. Sign up as a new user → lands on `/onboarding`.
  2. Fill form: name "Test Kommune", orgType=municipality → redirects to `/pending`.
  3. Confirm: `SELECT * FROM entitlements` shows one row `status='pending'`, `clerk_org_id` matches the new Clerk org.
  4. Confirm Clerk dashboard: new org exists with `publicMetadata.orgType = "municipality"`.
  5. Navigate to `/` → redirects back to `/pending`.

- [ ] **C. Super-admin approval**
  1. Sign out. Sign in as a superadmin user (with `publicMetadata.role = "superadmin"`).
  2. Visit `/admin` → see "Test Kommune" in pending list.
  3. Click "Godkjenn" → row flips to `active`, audit row appears.
  4. Sign out.

- [ ] **D. Approved user uses the app**
  1. Sign in as the original Test Kommune user.
  2. Navigate to `/` → chat UI loads.
  3. Upload a PDF and send a message → chat streams normally.
  4. Confirm: `SELECT * FROM session_ownership` has one row linking the Anthropic session to `clerk_org_id` and `clerk_user_id`.
  5. Confirm: `SELECT * FROM audit_log WHERE event IN ('session.created','session.opened')` shows entries.

- [ ] **E. Cross-org isolation**
  1. Create a second org + user (e.g., "Other Org"), approve it, create one session, note the Anthropic session ID.
  2. Sign in as Test Kommune user; POST `/api/chat` with `sessionId = <Other Org's session id>` → returns 403.

- [ ] **F. Suspension**
  1. Super-admin suspends Test Kommune with notes "test" → row flips to `suspended`, audit row written.
  2. Test Kommune user refreshes `/` → redirects to `/pending` showing the suspension banner.

- [ ] **G. DB failure**
  1. Break `DATABASE_URL` (edit to a bad host) and restart dev server.
  2. Visit `/` as an authenticated user → 503 "Service unavailable" page renders (not `/pending`).
  3. Restore `DATABASE_URL`.

If every check passes, commit a final note:

```bash
git commit --allow-empty -m "chore: verified end-to-end smoke test"
```

---

## Out of scope (matches spec)

- Solo users without an org (no code path for `subject_type = 'user'`).
- Free-trial quotas (session/token limits).
- Stripe / automated billing.
- Org-admin self-service for `orgType`.
- Arkivloven-grade audit (append-only enforcement, retention, tamper evidence).
- Cross-org sponsorship.
- Session sidebar / multi-session UI.
- Background reaper for orphaned Anthropic sessions.

---

## Self-review notes

- **Spec coverage:** All spec sections (architecture, schema, Clerk integration, proxy, admin, existing-code changes, file layout, error handling, testing, out-of-scope) map to tasks 1–20.
- **Type consistency:** `lookupEntitlementStatus` returns `"none" | "pending" | "active" | "suspended"` everywhere. `requireActive` throws `NotActiveError`. `requireSuperadmin` throws `NotSuperadminError`. `createSession` params: `{ clerkOrgId, clerkUserId, title? }` consistent across tasks 16 and 17. `AnyDb` is `PgDatabase<PgQueryResultHKT, typeof schema>` in both `queries.ts` and `audit.ts`, accepting node-postgres, neon-serverless, pglite, and transaction objects.
- **No placeholders:** Each code step has complete code. Commands have expected output. Smoke tests have explicit steps.
- **Known ambiguity (verify at implementation time):** Clerk's exact export names for Next 16 proxy (`clerkMiddleware` vs a future `clerkProxy`) and Clerk's `auth()` return shape (`isAuthenticated` vs `userId` presence) may drift. Task 9 notes this; the engineer should consult the installed `@clerk/nextjs` types if the example does not compile.
