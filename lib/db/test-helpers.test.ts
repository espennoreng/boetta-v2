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
