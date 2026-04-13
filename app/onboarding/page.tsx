import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { CreateOrganization } from "@clerk/nextjs";

export default async function OnboardingPage() {
  const { userId, orgId } = await auth();
  if (!userId) redirect("/sign-in");
  if (orgId) redirect("/");

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <CreateOrganization
        afterCreateOrganizationUrl="/pending"
        skipInvitationScreen
      />
    </div>
  );
}
