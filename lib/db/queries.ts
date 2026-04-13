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
