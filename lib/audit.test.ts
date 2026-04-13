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
