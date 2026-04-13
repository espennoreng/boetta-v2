import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { SignOutButton } from "@clerk/nextjs";
import { ClockIcon, AlertTriangleIcon } from "lucide-react";
import { makeQueries } from "@/lib/db/queries";
import { db } from "@/lib/db";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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

export default async function PendingPage() {
  const { userId, orgId } = await auth();
  if (!userId) redirect("/sign-in");
  if (!orgId) redirect("/onboarding");

  await queries.upsertPendingEntitlement(orgId);
  const status = await queries.lookupEntitlementStatus(orgId);

  if (status === "active") redirect("/");

  const isSuspended = status === "suspended";

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-full bg-muted">
            {isSuspended ? (
              <AlertTriangleIcon className="size-5 text-destructive" />
            ) : (
              <ClockIcon className="size-5 text-muted-foreground" />
            )}
          </div>
          <CardTitle>
            {isSuspended ? "Tilgangen er suspendert" : "Venter på godkjenning"}
          </CardTitle>
          <CardDescription>
            {isSuspended
              ? "Kontakt support for mer informasjon."
              : "Organisasjonen din er registrert. Du kan lukke denne siden og komme tilbake senere."}
          </CardDescription>
        </CardHeader>
        {!isSuspended && (
          <CardContent>
            <Alert>
              <ClockIcon />
              <AlertTitle>Neste steg</AlertTitle>
              <AlertDescription>
                En administrator vil godkjenne tilgangen snart. Du får tilgang
                til applikasjonen så snart organisasjonen er godkjent.
              </AlertDescription>
            </Alert>
          </CardContent>
        )}
        <CardFooter className="justify-center">
          <SignOutButton>
            <Button variant="ghost" size="sm">
              Logg ut
            </Button>
          </SignOutButton>
        </CardFooter>
      </Card>
    </div>
  );
}
