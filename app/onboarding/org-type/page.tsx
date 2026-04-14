import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { submitOrgType } from "./actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function OrgTypePage() {
  const { userId, orgId } = await auth();
  if (!userId) redirect("/sign-in");
  if (!orgId) redirect("/onboarding");

  // If already picked, skip this step
  const client = await clerkClient();
  const org = await client.organizations.getOrganization({
    organizationId: orgId,
  });
  const existing = org.publicMetadata?.orgType;
  if (existing === "municipality" || existing === "tiltakshaver") {
    redirect("/agent");
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <form action={submitOrgType} className="w-full max-w-xl space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Hvilken type organisasjon?</h1>
          <p className="text-muted-foreground mt-2">
            Valget avgjør hvilke agenter du får tilgang til.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label>
            <input
              type="radio"
              name="orgType"
              value="municipality"
              className="peer sr-only"
              required
            />
            <Card className="cursor-pointer peer-checked:border-foreground peer-checked:ring-2 peer-checked:ring-foreground/20">
              <CardHeader>
                <CardTitle>Kommune</CardTitle>
                <CardDescription>
                  Saksbehandling av byggesøknader
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                For kommunale saksbehandlere.
              </CardContent>
            </Card>
          </label>
          <label>
            <input
              type="radio"
              name="orgType"
              value="tiltakshaver"
              className="peer sr-only"
              required
            />
            <Card className="cursor-pointer peer-checked:border-foreground peer-checked:ring-2 peer-checked:ring-foreground/20">
              <CardHeader>
                <CardTitle>Tiltakshaver</CardTitle>
                <CardDescription>
                  Byggesøknader og forberedelse
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                For deg som skal bygge eller tilrettelegge.
              </CardContent>
            </Card>
          </label>
        </div>
        <div className="flex justify-center">
          <Button type="submit">Fortsett</Button>
        </div>
      </form>
    </div>
  );
}
