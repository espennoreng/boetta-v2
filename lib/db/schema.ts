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
