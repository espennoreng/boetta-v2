import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { OrganizationList } from "@clerk/nextjs";

export default async function OnboardingPage() {
  const { userId, orgId } = await auth();
  if (!userId) redirect("/sign-in");
  if (orgId) redirect("/onboarding/org-type");

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <OrganizationList
        hidePersonal
        skipInvitationScreen
        afterCreateOrganizationUrl="/onboarding/org-type"
        afterSelectOrganizationUrl="/onboarding/org-type"
      />
    </div>
  );
}
