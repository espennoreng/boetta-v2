import { clerkClient } from "@clerk/nextjs/server";
import { makeQueries } from "@/lib/db/queries";
import { db } from "@/lib/db";
import { approveOrg, suspendOrg } from "./actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const queries = makeQueries(db);

type Status = "pending" | "active" | "suspended";

const statusVariant: Record<Status, "secondary" | "default" | "destructive"> = {
  pending: "secondary",
  active: "default",
  suspended: "destructive",
};

export default async function AdminPage() {
  const rows = await queries.listEntitlements();
  const client = await clerkClient();

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
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Organisasjon</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Opprettet</TableHead>
          <TableHead className="text-right">Handling</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orgs.map((o) => (
          <TableRow key={o.clerkOrgId}>
            <TableCell>
              <div className="font-medium">{o.name}</div>
              <div className="text-xs text-muted-foreground">
                {o.clerkOrgId}
              </div>
            </TableCell>
            <TableCell>{o.orgType}</TableCell>
            <TableCell>
              <Badge variant={statusVariant[o.status as Status]}>
                {o.status}
              </Badge>
            </TableCell>
            <TableCell>{o.createdAt.toISOString().slice(0, 10)}</TableCell>
            <TableCell>
              {o.status !== "active" ? (
                <form
                  action={approveOrg}
                  className="flex items-center gap-2 justify-end"
                >
                  <input
                    type="hidden"
                    name="clerkOrgId"
                    value={o.clerkOrgId}
                  />
                  <Select
                    name="orgType"
                    defaultValue={
                      o.orgType === "municipality" || o.orgType === "tiltakshaver"
                        ? o.orgType
                        : "tiltakshaver"
                    }
                  >
                    <SelectTrigger size="sm" className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="municipality">Kommune</SelectItem>
                      <SelectItem value="tiltakshaver">Tiltakshaver</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button type="submit" size="sm">
                    Godkjenn
                  </Button>
                </form>
              ) : (
                <form
                  action={suspendOrg}
                  className="flex items-center gap-2 justify-end"
                >
                  <input
                    type="hidden"
                    name="clerkOrgId"
                    value={o.clerkOrgId}
                  />
                  <Input
                    name="notes"
                    placeholder="Notat"
                    className="h-8 w-40"
                  />
                  <Button type="submit" size="sm" variant="destructive">
                    Suspender
                  </Button>
                </form>
              )}
            </TableCell>
          </TableRow>
        ))}
        {orgs.length === 0 && (
          <TableRow>
            <TableCell
              colSpan={5}
              className="py-8 text-center text-muted-foreground"
            >
              Ingen organisasjoner ennå.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
