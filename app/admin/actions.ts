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
