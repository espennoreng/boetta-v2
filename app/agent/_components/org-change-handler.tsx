"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useRef } from "react";

// Hard-reloads the page on Clerk org switch. A full browser navigation
// discards every React tree, App Router cache entry, and client-side hook
// state, which sidesteps the "Rendered more hooks than during the previous
// render" class of bug entirely when the org changes. /agent/page.tsx then
// server-redirects to /agent/<slug> for the new org.
export function OrgChangeHandler() {
  const { isLoaded, orgId } = useAuth();
  const prevRef = useRef<string | null | undefined>(undefined);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!isLoaded) return;
    if (!initializedRef.current) {
      // First post-hydration render — capture baseline, don't treat
      // Clerk's `undefined -> orgId` transition as an org switch.
      initializedRef.current = true;
      prevRef.current = orgId;
      return;
    }
    if (prevRef.current !== orgId) {
      prevRef.current = orgId;
      window.location.assign("/agent");
    }
  }, [isLoaded, orgId]);

  return null;
}
