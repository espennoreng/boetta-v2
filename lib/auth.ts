import { auth } from "@clerk/nextjs/server";
import { makeQueries } from "./db/queries";
import { db } from "./db";

export class NotSuperadminError extends Error {
  constructor() {
    super("Caller is not a superadmin");
    this.name = "NotSuperadminError";
  }
}

export class NotActiveError extends Error {
  constructor(public readonly status: "none" | "pending" | "suspended") {
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

export function isSuperadmin(
  publicMetadata: Record<string, unknown> | null | undefined,
): boolean {
  if (!publicMetadata) return false;
  return publicMetadata.role === "superadmin";
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
 * entitlement is 'active'. Returns the context.
 */
export async function requireActive(): Promise<CurrentContext> {
  const ctx = await getCurrentContext();
  const status = await queries.lookupEntitlementStatus(ctx.orgId);
  if (status !== "active") {
    throw new NotActiveError(status as "none" | "pending" | "suspended");
  }
  return ctx;
}

/**
 * Asserts the caller is a superadmin. Throws NotSuperadminError otherwise.
 */
export async function requireSuperadmin(): Promise<{ userId: string }> {
  const { userId, sessionClaims } = await auth();
  if (!userId) throw new NotAuthenticatedError();
  const publicMetadata = (sessionClaims?.publicMetadata ?? {}) as Record<
    string,
    unknown
  >;
  if (!isSuperadmin(publicMetadata)) throw new NotSuperadminError();
  return { userId };
}
