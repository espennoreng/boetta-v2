import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { makeQueries } from "@/lib/db/queries";
import { makeAudit } from "@/lib/audit";
import { db } from "@/lib/db";

const queries = makeQueries(db);
const audit = makeAudit(db);

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/personvern(.*)",
  "/vilkar(.*)",
  "/kontakt(.*)",
]);

const isOnboardingRoute = createRouteMatcher(["/onboarding(.*)"]);
const isOrgTypeRoute = createRouteMatcher(["/onboarding/org-type(.*)"]);
const isTrialExpiredRoute = createRouteMatcher(["/trial-expired(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;

  const { isAuthenticated, userId, orgId, redirectToSignIn } = await auth();
  if (!isAuthenticated) return redirectToSignIn();

  // Org gate
  if (!orgId) {
    if (isOnboardingRoute(req)) return;
    return NextResponse.redirect(new URL("/onboarding", req.url));
  }

  // orgType gate — new user needs to pick org type before anything else
  if (!isOrgTypeRoute(req)) {
    let orgType: unknown;
    try {
      const client = await clerkClient();
      const org = await client.organizations.getOrganization({
        organizationId: orgId,
      });
      orgType = org.publicMetadata?.orgType;
    } catch (err) {
      console.error("[proxy] clerk org lookup failed", err);
      return new NextResponse("Service unavailable", { status: 503 });
    }
    if (orgType !== "municipality" && orgType !== "tiltakshaver") {
      return NextResponse.redirect(
        new URL("/onboarding/org-type", req.url),
      );
    }
  } else {
    // On the org-type page itself, skip the entitlement gate below.
    return;
  }

  // Entitlement gate. /trial-expired is allowed for any authed+org user.
  if (isTrialExpiredRoute(req)) return;

  let row: Awaited<ReturnType<typeof queries.getEntitlement>>;
  try {
    row = await queries.getEntitlement(orgId);
  } catch (err) {
    console.error("[proxy] entitlement lookup failed", err);
    return new NextResponse("Service unavailable", { status: 503 });
  }

  if (!row) {
    // Shouldn't normally happen (org-type action creates the row), but be safe
    return NextResponse.redirect(new URL("/onboarding/org-type", req.url));
  }

  if (row.status === "active") return;

  if (row.status === "trial") {
    if (row.trialEndsAt !== null && row.trialEndsAt.getTime() > Date.now()) {
      return;
    }
    // Trial expired — flip lazily, then redirect
    try {
      await queries.expireEntitlement(orgId);
      await audit.logEvent({
        actorUserId: userId!,
        actorOrgId: orgId,
        event: "entitlement.expired",
        subjectType: "entitlement",
        subjectId: orgId,
      });
    } catch (err) {
      console.error("[proxy] failed to flip trial→expired", err);
      // Fall through to redirect anyway — don't 500 the user
    }
    return NextResponse.redirect(new URL("/trial-expired", req.url));
  }

  // status === 'expired' (or anything else unexpected)
  return NextResponse.redirect(new URL("/trial-expired", req.url));
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
