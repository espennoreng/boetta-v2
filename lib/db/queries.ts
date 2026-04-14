import { eq, asc, desc, and, isNull, sql, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { entitlements, sessionOwnership, attachments } from "./schema";

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
      agentType: string;
      title?: string;
    }) {
      await db.insert(sessionOwnership).values({
        anthropicSessionId: params.anthropicSessionId,
        clerkOrgId: params.clerkOrgId,
        clerkUserId: params.clerkUserId,
        agentType: params.agentType,
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

    async getAgentTypeBySessionId(anthropicSessionId: string): Promise<string | null> {
      const [row] = await db
        .select({ agentType: sessionOwnership.agentType })
        .from(sessionOwnership)
        .where(eq(sessionOwnership.anthropicSessionId, anthropicSessionId))
        .limit(1);
      return row?.agentType ?? null;
    },

    async listSessionsForOrg(clerkOrgId: string) {
      return db
        .select({
          anthropicSessionId: sessionOwnership.anthropicSessionId,
          title: sessionOwnership.title,
          agentType: sessionOwnership.agentType,
          createdAt: sessionOwnership.createdAt,
        })
        .from(sessionOwnership)
        .where(
          and(
            eq(sessionOwnership.clerkOrgId, clerkOrgId),
            isNull(sessionOwnership.archivedAt),
          ),
        )
        .orderBy(desc(sessionOwnership.createdAt));
    },

    async updateSessionTitle(anthropicSessionId: string, title: string) {
      await db
        .update(sessionOwnership)
        .set({ title })
        .where(eq(sessionOwnership.anthropicSessionId, anthropicSessionId));
    },

    async createAttachment(params: {
      clerkOrgId: string;
      clerkUserId: string;
      anthropicSessionId: string;
      r2Key: string;
      mime: string;
      sizeBytes: number;
      originalName: string;
    }): Promise<string> {
      const [row] = await db
        .insert(attachments)
        .values({
          clerkOrgId: params.clerkOrgId,
          clerkUserId: params.clerkUserId,
          anthropicSessionId: params.anthropicSessionId,
          r2Key: params.r2Key,
          mime: params.mime,
          sizeBytes: params.sizeBytes,
          originalName: params.originalName,
          status: "pending",
        })
        .returning({ id: attachments.id });
      return row.id;
    },

    async markAttachmentUploaded(params: { id: string; clerkOrgId: string }) {
      await db
        .update(attachments)
        .set({ status: "uploaded", uploadedAt: new Date() })
        .where(
          and(
            eq(attachments.id, params.id),
            eq(attachments.clerkOrgId, params.clerkOrgId),
          ),
        );
    },

    async getAttachmentsForChat(params: { ids: string[]; clerkOrgId: string }) {
      if (params.ids.length === 0) return [];
      return db
        .select()
        .from(attachments)
        .where(
          and(
            inArray(attachments.id, params.ids),
            eq(attachments.clerkOrgId, params.clerkOrgId),
            eq(attachments.status, "uploaded"),
          ),
        );
    },

    async getAttachmentsBySession(params: {
      anthropicSessionId: string;
      clerkOrgId: string;
    }) {
      return db
        .select({
          id: attachments.id,
          anthropicFileId: attachments.anthropicFileId,
          originalName: attachments.originalName,
        })
        .from(attachments)
        .where(
          and(
            eq(attachments.anthropicSessionId, params.anthropicSessionId),
            eq(attachments.clerkOrgId, params.clerkOrgId),
            eq(attachments.status, "uploaded"),
          ),
        );
    },

    async setAnthropicFileId(params: { id: string; anthropicFileId: string }) {
      await db
        .update(attachments)
        .set({ anthropicFileId: params.anthropicFileId })
        .where(eq(attachments.id, params.id));
    },

    async clearAnthropicFileId(params: { id: string }) {
      await db
        .update(attachments)
        .set({ anthropicFileId: null })
        .where(eq(attachments.id, params.id));
    },

    async getAttachmentForDownload(params: { id: string; clerkOrgId: string }) {
      const [row] = await db
        .select()
        .from(attachments)
        .where(
          and(
            eq(attachments.id, params.id),
            eq(attachments.clerkOrgId, params.clerkOrgId),
            eq(attachments.status, "uploaded"),
          ),
        )
        .limit(1);
      return row ?? null;
    },
  };
}
