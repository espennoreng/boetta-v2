import { clerkClient } from "@clerk/nextjs/server";
import { forbidden } from "next/navigation";
import { requireActive } from "@/lib/auth";
import { allowedAgentsFor, type OrgType } from "@/lib/agents/registry";
import ChatPage from "@/components/chat-page";

export default async function NewSessionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await requireActive();

  const client = await clerkClient();
  const org = await client.organizations.getOrganization({
    organizationId: ctx.orgId,
  });
  const orgType = org.publicMetadata?.orgType as OrgType | undefined;

  if (!allowedAgentsFor(orgType).includes(slug)) {
    forbidden();
  }

  return <ChatPage agentType={slug} />;
}
