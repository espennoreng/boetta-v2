import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { sql } from "drizzle-orm";
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

describe("listSessionsForOrg", () => {
  it("returns sessions for the given org, newest first", async () => {
    await q.recordSessionOwnership({
      anthropicSessionId: "sess_old",
      clerkOrgId: "org_a",
      clerkUserId: "user_1",
    });
    // Small delay to ensure distinct created_at; PGlite resolves now() per statement.
    await new Promise((r) => setTimeout(r, 5));
    await q.recordSessionOwnership({
      anthropicSessionId: "sess_new",
      clerkOrgId: "org_a",
      clerkUserId: "user_1",
      title: "Byggesak Bergen",
    });
    await q.recordSessionOwnership({
      anthropicSessionId: "sess_other_org",
      clerkOrgId: "org_b",
      clerkUserId: "user_2",
    });

    const rows = await q.listSessionsForOrg("org_a");
    expect(rows.map((r) => r.anthropicSessionId)).toEqual(["sess_new", "sess_old"]);
    expect(rows[0].title).toBe("Byggesak Bergen");
  });

  it("excludes archived sessions", async () => {
    await q.recordSessionOwnership({
      anthropicSessionId: "sess_a",
      clerkOrgId: "org_a",
      clerkUserId: "user_1",
    });
    await testDb.db.execute(
      sql`UPDATE session_ownership SET archived_at = now() WHERE anthropic_session_id = 'sess_a'`,
    );
    const rows = await q.listSessionsForOrg("org_a");
    expect(rows).toHaveLength(0);
  });

  it("returns empty array when org has no sessions", async () => {
    expect(await q.listSessionsForOrg("org_empty")).toEqual([]);
  });
});

describe("updateSessionTitle", () => {
  it("updates the title for an existing session", async () => {
    await q.recordSessionOwnership({
      anthropicSessionId: "sess_1",
      clerkOrgId: "org_a",
      clerkUserId: "user_1",
    });
    await q.updateSessionTitle("sess_1", "Fradeling av tomt");
    const row = await q.getSessionOwnership("sess_1");
    expect(row?.title).toBe("Fradeling av tomt");
  });

  it("is a no-op for unknown session id", async () => {
    await q.updateSessionTitle("sess_missing", "x");
    expect(await q.getSessionOwnership("sess_missing")).toBeNull();
  });
});
