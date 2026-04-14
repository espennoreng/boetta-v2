"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { makeQueries } from "@/lib/db/queries";
import { makeAudit } from "@/lib/audit";
import { db } from "@/lib/db";

const TRIAL_DAYS = 14;

export async function submitOrgType(formData: FormData) {
  const { userId, orgId } = await auth();
  if (!userId) redirect("/sign-in");
  if (!orgId) redirect("/onboarding");

  const orgType = String(formData.get("orgType") ?? "");
  if (orgType !== "municipality" && orgType !== "tiltakshaver") {
    throw new Error("orgType invalid");
  }

  // 1. Create trial entitlement + audit log (transactional)
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 3600 * 1000);
  await db.transaction(async (tx) => {
    const txQueries = makeQueries(tx);
    const txAudit = makeAudit(tx);
    await txQueries.createTrialEntitlement({
      clerkOrgId: orgId,
      trialEndsAt,
    });
    await txAudit.logEvent({
      actorUserId: userId,
      actorOrgId: orgId,
      event: "entitlement.created",
      subjectType: "entitlement",
      subjectId: orgId,
    });
  });

  // 2. Write orgType to Clerk publicMetadata (after DB persisted)
  const client = await clerkClient();
  await client.organizations.updateOrganization(orgId, {
    publicMetadata: { orgType },
  });

  redirect("/agent");
}
