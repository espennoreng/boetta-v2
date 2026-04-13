import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { createOrgWithType } from "./actions";

export default async function OnboardingPage() {
  const { userId, orgId } = await auth();
  if (!userId) redirect("/sign-in");

  if (orgId) {
    // Already in an org; skip onboarding
    redirect("/");
  }

  return (
    <div className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold mb-4">Velkommen til Boetta</h1>
      <p className="mb-6 text-sm text-gray-600">
        Opprett organisasjonen din for å komme i gang. En administrator godkjenner
        tilgang før du kan bruke applikasjonen.
      </p>

      <form action={createOrgWithType} className="space-y-4">
        <label className="block">
          <span className="block text-sm font-medium mb-1">Navn</span>
          <input
            name="name"
            required
            className="w-full rounded border px-3 py-2"
            placeholder="Oslo kommune / Acme Arkitekter AS"
          />
        </label>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Type organisasjon</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="orgType" value="municipality" required />
            <span>Kommune</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="orgType" value="business" />
            <span>Bedrift</span>
          </label>
        </fieldset>

        <button
          type="submit"
          className="rounded bg-black text-white px-4 py-2"
        >
          Opprett organisasjon
        </button>
      </form>
    </div>
  );
}
