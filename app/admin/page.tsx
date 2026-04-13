import { clerkClient } from "@clerk/nextjs/server";
import { makeQueries } from "@/lib/db/queries";
import { db } from "@/lib/db";
import { approveOrg, suspendOrg } from "./actions";

const queries = makeQueries(db);

export default async function AdminPage() {
  const rows = await queries.listEntitlements();
  const client = await clerkClient();

  // Fetch Clerk org details in parallel
  const orgs = await Promise.all(
    rows.map(async (r) => {
      try {
        const org = await client.organizations.getOrganization({
          organizationId: r.clerkOrgId,
        });
        const orgType =
          (org.publicMetadata?.orgType as string | undefined) ?? "—";
        return { ...r, name: org.name, orgType };
      } catch {
        return { ...r, name: "(unknown)", orgType: "—" };
      }
    }),
  );

  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="text-left border-b">
          <th className="py-2">Org</th>
          <th>Type</th>
          <th>Status</th>
          <th>Opprettet</th>
          <th>Handling</th>
        </tr>
      </thead>
      <tbody>
        {orgs.map((o) => (
          <tr key={o.clerkOrgId} className="border-b align-top">
            <td className="py-2">
              <div className="font-medium">{o.name}</div>
              <div className="text-xs text-gray-500">{o.clerkOrgId}</div>
            </td>
            <td>{o.orgType}</td>
            <td>{o.status}</td>
            <td>{o.createdAt.toISOString().slice(0, 10)}</td>
            <td>
              <div className="flex gap-2 items-start">
                {o.status !== "active" && (
                  <form action={approveOrg}>
                    <input
                      type="hidden"
                      name="clerkOrgId"
                      value={o.clerkOrgId}
                    />
                    <select name="orgType" defaultValue={o.orgType} className="border px-1 text-xs">
                      <option value="municipality">municipality</option>
                      <option value="business">business</option>
                    </select>
                    <button className="ml-2 px-2 py-1 bg-green-700 text-white rounded text-xs">
                      Godkjenn
                    </button>
                  </form>
                )}
                {o.status === "active" && (
                  <form action={suspendOrg}>
                    <input
                      type="hidden"
                      name="clerkOrgId"
                      value={o.clerkOrgId}
                    />
                    <input
                      name="notes"
                      placeholder="Notat"
                      className="border px-2 py-1 text-xs"
                    />
                    <button className="ml-2 px-2 py-1 bg-red-700 text-white rounded text-xs">
                      Suspender
                    </button>
                  </form>
                )}
              </div>
            </td>
          </tr>
        ))}
        {orgs.length === 0 && (
          <tr>
            <td colSpan={5} className="py-8 text-center text-gray-500">
              Ingen organisasjoner ennå.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
