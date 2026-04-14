import { eq, asc, desc, and, isNull, sql, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { entitlements, sessionOwnership, attachments } from "./schema";

export type EntitlementStatus = "none" | "trial" | "active" | "expired";

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

    async createTrialEntitlement(params: {
      clerkOrgId: string;
      trialEndsAt: Date;
    }) {
      await db
        .insert(entitlements)
        .values({
          clerkOrgId: params.clerkOrgId,
          status: "trial",
          trialEndsAt: params.trialEndsAt,
        })
        .onConflictDoNothing({ target: entitlements.clerkOrgId });
    },

    async expireEntitlement(clerkOrgId: string) {
      await db
        .update(entitlements)
        .set({ status: "expired", updatedAt: new Date() })
        .where(eq(entitlements.clerkOrgId, clerkOrgId));
    },

    async listEntitlements() {
      // Trial first, then active, then expired; within each, oldest-created first
      return db
        .select()
        .from(entitlements)
        .orderBy(
          sql`case ${entitlements.status}
              when 'trial'   then 0
              when 'active'  then 1
              when 'expired' then 2
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
