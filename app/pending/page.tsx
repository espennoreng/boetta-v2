import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { makeQueries } from "@/lib/db/queries";
import { db } from "@/lib/db";
import { SignOutButton } from "@clerk/nextjs";

const queries = makeQueries(db);

export default async function PendingPage() {
  const { userId, orgId } = await auth();
  if (!userId) redirect("/sign-in");
  if (!orgId) redirect("/onboarding");

  // Ensure an entitlement row exists even if the user arrived via a direct link
  await queries.upsertPendingEntitlement(orgId);
  const status = await queries.lookupEntitlementStatus(orgId);

  if (status === "active") redirect("/");

  return (
    <div className="mx-auto max-w-xl p-8 text-center">
      <h1 className="text-2xl font-semibold mb-4">Venter på godkjenning</h1>
      <p className="text-gray-600 mb-6">
        Organisasjonen din er registrert. En administrator vil godkjenne
        tilgangen snart. Du kan lukke denne siden og komme tilbake senere.
      </p>
      {status === "suspended" && (
        <p className="text-red-600 mb-4">
          Tilgangen er midlertidig suspendert. Kontakt support for mer
          informasjon.
        </p>
      )}
      <SignOutButton>
        <button className="underline text-sm">Logg ut</button>
      </SignOutButton>
    </div>
  );
}
