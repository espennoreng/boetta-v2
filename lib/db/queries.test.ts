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
    await q.createTrialEntitlement({
      clerkOrgId: "org_a",
      trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000),
    });
    expect(await q.lookupEntitlementStatus("org_a")).toBe("trial");
  });
});

describe("createTrialEntitlement", () => {
  it("creates a trial row with the given trialEndsAt", async () => {
    const ends = new Date(Date.now() + 14 * 24 * 3600 * 1000);
    await q.createTrialEntitlement({ clerkOrgId: "org_a", trialEndsAt: ends });
    const row = await q.getEntitlement("org_a");
    expect(row?.status).toBe("trial");
    expect(row?.trialEndsAt).toBeInstanceOf(Date);
    expect(row!.trialEndsAt!.getTime()).toBe(ends.getTime());
  });

  it("is idempotent — a second call does not overwrite an existing row", async () => {
    const ends1 = new Date(Date.now() + 14 * 24 * 3600 * 1000);
    const ends2 = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    await q.createTrialEntitlement({ clerkOrgId: "org_a", trialEndsAt: ends1 });
    await q.createTrialEntitlement({ clerkOrgId: "org_a", trialEndsAt: ends2 });
    const row = await q.getEntitlement("org_a");
    expect(row!.trialEndsAt!.getTime()).toBe(ends1.getTime());
  });
});

describe("expireEntitlement", () => {
  it("flips trial → expired", async () => {
    await q.createTrialEntitlement({
      clerkOrgId: "org_a",
      trialEndsAt: new Date(Date.now() - 1000),
    });
    await q.expireEntitlement("org_a");
    expect(await q.lookupEntitlementStatus("org_a")).toBe("expired");
  });

  it("is a no-op for unknown org", async () => {
    await q.expireEntitlement("org_missing");
    expect(await q.lookupEntitlementStatus("org_missing")).toBe("none");
  });
});

describe("listEntitlements", () => {
  it("returns trial rows before active rows before expired rows", async () => {
    const now = Date.now();
    await q.createTrialEntitlement({
      clerkOrgId: "org_trial",
      trialEndsAt: new Date(now + 14 * 24 * 3600 * 1000),
    });
    await q.createTrialEntitlement({
      clerkOrgId: "org_expired",
      trialEndsAt: new Date(now - 1000),
    });
    await q.expireEntitlement("org_expired");
    await testDb.db.execute(
      sql`INSERT INTO entitlements (clerk_org_id, status) VALUES ('org_active', 'active')`,
    );
    const rows = await q.listEntitlements();
    expect(rows.map((r) => r.clerkOrgId)).toEqual([
      "org_trial",
      "org_active",
      "org_expired",
    ]);
  });
});

describe("recordSessionOwnership + getSessionOwnership", () => {
  it("stores and retrieves ownership", async () => {
    await q.recordSessionOwnership({
      anthropicSessionId: "sess_1",
      clerkOrgId: "org_a",
      clerkUserId: "user_1",
      agentType: "kommune-byggesak-saksbehandler",
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
      agentType: "kommune-byggesak-saksbehandler",
    });
    // Small delay to ensure distinct created_at; PGlite resolves now() per statement.
    await new Promise((r) => setTimeout(r, 5));
    await q.recordSessionOwnership({
      anthropicSessionId: "sess_new",
      clerkOrgId: "org_a",
      clerkUserId: "user_1",
      agentType: "kommune-byggesak-saksbehandler",
      title: "Byggesak Bergen",
    });
    await q.recordSessionOwnership({
      anthropicSessionId: "sess_other_org",
      clerkOrgId: "org_b",
      clerkUserId: "user_2",
      agentType: "kommune-byggesak-saksbehandler",
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
      agentType: "kommune-byggesak-saksbehandler",
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
      agentType: "kommune-byggesak-saksbehandler",
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

describe("createAttachment / markAttachmentUploaded", () => {
  it("inserts a pending row and returns the id", async () => {
    const id = await q.createAttachment({
      clerkOrgId: "org_a",
      clerkUserId: "user_1",
      anthropicSessionId: "sess_1",
      r2Key: "org/org_a/session/sess_1/abc-doc.pdf",
      mime: "application/pdf",
      sizeBytes: 1234,
      originalName: "doc.pdf",
    });
    expect(typeof id).toBe("string");
    const row = await q.getAttachmentForDownload({ id, clerkOrgId: "org_a" });
    expect(row).toBeNull(); // not yet uploaded — getAttachmentForDownload requires status='uploaded'
  });

  it("markAttachmentUploaded flips status and sets uploaded_at", async () => {
    const id = await q.createAttachment({
      clerkOrgId: "org_a",
      clerkUserId: "user_1",
      anthropicSessionId: "sess_1",
      r2Key: "k",
      mime: "application/pdf",
      sizeBytes: 1,
      originalName: "x.pdf",
    });
    await q.markAttachmentUploaded({ id, clerkOrgId: "org_a" });
    const row = await q.getAttachmentForDownload({ id, clerkOrgId: "org_a" });
    expect(row?.status).toBe("uploaded");
    expect(row?.uploadedAt).toBeInstanceOf(Date);
  });

  it("markAttachmentUploaded refuses to flip across orgs", async () => {
    const id = await q.createAttachment({
      clerkOrgId: "org_a",
      clerkUserId: "user_1",
      anthropicSessionId: "sess_1",
      r2Key: "k",
      mime: "application/pdf",
      sizeBytes: 1,
      originalName: "x.pdf",
    });
    await q.markAttachmentUploaded({ id, clerkOrgId: "org_b" });
    const row = await q.getAttachmentForDownload({ id, clerkOrgId: "org_a" });
    expect(row).toBeNull();
  });
});

describe("getAttachmentsForChat", () => {
  it("returns only uploaded rows in the given org and id set", async () => {
    const idA = await q.createAttachment({
      clerkOrgId: "org_a", clerkUserId: "u", anthropicSessionId: "s",
      r2Key: "a", mime: "application/pdf", sizeBytes: 1, originalName: "a.pdf",
    });
    const idB = await q.createAttachment({
      clerkOrgId: "org_a", clerkUserId: "u", anthropicSessionId: "s",
      r2Key: "b", mime: "application/pdf", sizeBytes: 1, originalName: "b.pdf",
    });
    const idForeign = await q.createAttachment({
      clerkOrgId: "org_b", clerkUserId: "u", anthropicSessionId: "s",
      r2Key: "c", mime: "application/pdf", sizeBytes: 1, originalName: "c.pdf",
    });
    await q.markAttachmentUploaded({ id: idA, clerkOrgId: "org_a" });

    const rows = await q.getAttachmentsForChat({
      ids: [idA, idB, idForeign],
      clerkOrgId: "org_a",
    });
    expect(rows.map((r) => r.id)).toEqual([idA]);
  });
});

describe("setAnthropicFileId / clearAnthropicFileId", () => {
  it("sets and clears the file_id", async () => {
    const id = await q.createAttachment({
      clerkOrgId: "org_a", clerkUserId: "u", anthropicSessionId: "s",
      r2Key: "k", mime: "application/pdf", sizeBytes: 1, originalName: "x.pdf",
    });
    await q.markAttachmentUploaded({ id, clerkOrgId: "org_a" });
    await q.setAnthropicFileId({ id, anthropicFileId: "file_123" });
    let row = await q.getAttachmentForDownload({ id, clerkOrgId: "org_a" });
    expect(row?.anthropicFileId).toBe("file_123");

    await q.clearAnthropicFileId({ id });
    row = await q.getAttachmentForDownload({ id, clerkOrgId: "org_a" });
    expect(row?.anthropicFileId).toBeNull();
  });
});
