import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { makeQueries } from "@/lib/db/queries";
import { db } from "@/lib/db";

const queries = makeQueries(db);

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/personvern(.*)",
  "/vilkar(.*)",
  "/kontakt(.*)",
]);

const isOnboardingRoute = createRouteMatcher(["/onboarding(.*)"]);
const isPendingRoute = createRouteMatcher(["/pending(.*)"]);
const isAdminRoute = createRouteMatcher(["/admin(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isPublicRoute(req)) return;

  const { isAuthenticated, userId, orgId, redirectToSignIn } = await auth();
  if (!isAuthenticated) return redirectToSignIn();

  // Super-admin surface and sign-out live above the gate
  if (isAdminRoute(req)) return;

  // Onboarding allowed when there's no active org
  if (!orgId) {
    if (isOnboardingRoute(req)) return;
    return NextResponse.redirect(new URL("/onboarding", req.url));
  }

  // Pending page is allowed for any auth'd user with an org (regardless of status)
  if (isPendingRoute(req)) return;

  // Entitlement check
  let status: "none" | "pending" | "active" | "suspended";
  try {
    status = await queries.lookupEntitlementStatus(orgId);
  } catch (err) {
    console.error("[proxy] entitlement lookup failed", err);
    return new NextResponse("Service unavailable", { status: 503 });
  }

  if (status !== "active") {
    return NextResponse.redirect(new URL("/pending", req.url));
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
