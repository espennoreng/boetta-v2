import { auth } from "@clerk/nextjs/server";
import { makeQueries } from "./db/queries";
import { db } from "./db";

export class NotActiveError extends Error {
  constructor(public readonly status: "none" | "trial" | "active" | "expired") {
    super(`Caller org is not active (status: ${status})`);
    this.name = "NotActiveError";
  }
}

export class NotAuthenticatedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "NotAuthenticatedError";
  }
}

export class NoOrgError extends Error {
  constructor() {
    super("No active organization");
    this.name = "NoOrgError";
  }
}

const queries = makeQueries(db);

export interface CurrentContext {
  userId: string;
  orgId: string;
}

/**
 * Returns the current user and active org. Throws if unauthenticated or no org.
 */
export async function getCurrentContext(): Promise<CurrentContext> {
  const { userId, orgId } = await auth();
  if (!userId) throw new NotAuthenticatedError();
  if (!orgId) throw new NoOrgError();
  return { userId, orgId };
}

/**
 * Asserts the caller is authenticated, has an active org, and the org's
 * entitlement grants access — either `status='active'`, or `status='trial'`
 * with `trialEndsAt` still in the future. Throws NotActiveError otherwise.
 */
export async function requireActive(): Promise<CurrentContext> {
  const ctx = await getCurrentContext();
  const row = await queries.getEntitlement(ctx.orgId);
  if (!row) throw new NotActiveError("none");
  if (row.status === "active") return ctx;
  if (
    row.status === "trial" &&
    row.trialEndsAt !== null &&
    row.trialEndsAt.getTime() > Date.now()
  ) {
    return ctx;
  }
  throw new NotActiveError(row.status as "none" | "trial" | "active" | "expired");
}
