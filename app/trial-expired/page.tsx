import Link from "next/link";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { SignOutButton } from "@clerk/nextjs";
import { AlertTriangleIcon } from "lucide-react";
import { makeQueries } from "@/lib/db/queries";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const queries = makeQueries(db);

export default async function TrialExpiredPage() {
  const { userId, orgId } = await auth();
  if (!userId) redirect("/sign-in");
  if (!orgId) redirect("/onboarding");

  const row = await queries.getEntitlement(orgId);

  // Paid / unlimited users shouldn't ever land here
  if (row?.status === "active") redirect("/agent");

  // Active-trial users shouldn't land here either (middleware would have let them through)
  if (
    row?.status === "trial" &&
    row.trialEndsAt !== null &&
    row.trialEndsAt.getTime() > Date.now()
  ) {
    redirect("/agent");
  }

  const client = await clerkClient();
  const org = await client.organizations.getOrganization({
    organizationId: orgId,
  });

  const endedAt = row?.trialEndsAt
    ? row.trialEndsAt.toISOString().slice(0, 10)
    : "—";

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-full bg-muted">
            <AlertTriangleIcon className="size-5 text-destructive" />
          </div>
          <CardTitle>Prøveperioden er utløpt</CardTitle>
          <CardDescription>
            Den 14 dagers prøveperioden for <strong>{org.name}</strong> tok
            slutt {endedAt}.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground text-center">
          Kontakt oss for å fortsette å bruke Boetta.
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          <Button asChild className="w-full">
            <Link href="/kontakt">Kontakt oss</Link>
          </Button>
          <SignOutButton>
            <Button variant="ghost" size="sm" className="w-full">
              Logg ut
            </Button>
          </SignOutButton>
        </CardFooter>
      </Card>
    </div>
  );
}
