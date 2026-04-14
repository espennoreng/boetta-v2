import { clerkClient } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { requireActive } from "@/lib/auth";
import { allowedAgentsFor, type OrgType } from "@/lib/agents/registry";
import { makeQueries } from "@/lib/db/queries";
import { db } from "@/lib/db";
import ChatPage from "@/components/chat-page";

const queries = makeQueries(db);

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

  if (allowedAgentsFor(orgType).includes(slug)) {
    return <ChatPage agentType={slug} />;
  }

  // `slug` isn't a recognized agent for this org. It might be a legacy
  // session ID from before the slug-scoped routing. Check ownership; if
  // the caller owns it, redirect to the canonical URL. Otherwise forbid.
  const ownership = await queries.getSessionOwnership(slug);
  if (ownership && ownership.clerkOrgId === ctx.orgId) {
    redirect(`/agent/${ownership.agentType}/${slug}`);
  }

  notFound();
}
