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
