import { clerkClient } from "@clerk/nextjs/server";
import { getCurrentContext, type NotActiveError } from "@/lib/auth";
import { allowedAgentsFor, getAgent, type OrgType } from "@/lib/agents/registry";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AgentSidebar } from "./_components/agent-sidebar";
import { SessionsProvider } from "./_components/sessions-provider";

export type SidebarAgentInfo = {
  slug: string;
  newSessionLabel: string;
  sessionGroupLabel: string;
};

async function getSidebarAgentInfo(): Promise<SidebarAgentInfo[]> {
  try {
    const ctx = await getCurrentContext();
    const client = await clerkClient();
    const org = await client.organizations.getOrganization({
      organizationId: ctx.orgId,
    });
    const orgType = org.publicMetadata?.orgType as OrgType | undefined;
    const allowedAgents = allowedAgentsFor(orgType);
    return allowedAgents.map((slug) => ({
      slug,
      newSessionLabel: getAgent(slug).ui?.newSessionLabel ?? slug,
      sessionGroupLabel: getAgent(slug).ui?.sessionGroupLabel ?? slug,
    }));
  } catch (err) {
    // If auth fails or org can't be fetched, return empty (client will handle)
    const isNotActive =
      err instanceof Error && err.name === "NotActiveError";
    if (isNotActive || !process.env.NEXT_PUBLIC_DISABLE_SIDEBAR) {
      return [];
    }
    throw err;
  }
}

export default async function AgentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sidebarAgents = await getSidebarAgentInfo();

  return (
    <SessionsProvider>
      <SidebarProvider>
        <AgentSidebar sidebarAgents={sidebarAgents} />
        <SidebarInset>{children}</SidebarInset>
      </SidebarProvider>
    </SessionsProvider>
  );
}
