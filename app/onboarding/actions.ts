"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { makeQueries } from "@/lib/db/queries";
import { db } from "@/lib/db";

const queries = makeQueries(db);

export async function createOrgWithType(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const orgType = String(formData.get("orgType") ?? "");

  if (!name) throw new Error("Name is required");
  if (orgType !== "municipality" && orgType !== "business") {
    throw new Error("orgType must be 'municipality' or 'business'");
  }

  const { userId } = await auth();
  if (!userId) throw new Error("Not authenticated");

  const client = await clerkClient();

  const org = await client.organizations.createOrganization({
    name,
    createdBy: userId,
    publicMetadata: { orgType },
  });

  // Upsert a pending entitlement for the new org
  await queries.upsertPendingEntitlement(org.id);

  // Activate the new org on the user's session so subsequent requests pick it up.
  // Clerk updates the session claim on next cookie round-trip; the redirect below
  // triggers that round-trip.
  redirect("/pending");
}
