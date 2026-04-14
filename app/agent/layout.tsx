import { clerkClient } from "@clerk/nextjs/server";
import { getCurrentContext } from "@/lib/auth";
import { allowedAgentsFor, getAgent, type OrgType } from "@/lib/agents/registry";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AgentSidebar } from "./_components/agent-sidebar";
import { OrgChangeHandler } from "./_components/org-change-handler";
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
    // Auth-family errors: treat as "no allowed agents" (child page will redirect/handle).
    // Any other error (network, Clerk outage, etc.) should bubble up to the nearest
    // error boundary rather than silently hiding the sidebar.
    const name = err instanceof Error ? err.name : "";
    if (
      name === "NotAuthenticatedError" ||
      name === "NoOrgError" ||
      name === "NotActiveError"
    ) {
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

  // OrgChangeHandler does a full browser reload to /agent on Clerk org
  // switch — bulletproof way to avoid the "Rendered more hooks than during
  // the previous render" error that occurs when the sidebar's hook shape
  // changes between orgs. /agent/page.tsx then server-redirects to
  // /agent/<slug> for the new org.
  return (
    <>
      <OrgChangeHandler />
      <SessionsProvider>
        <SidebarProvider>
          <AgentSidebar sidebarAgents={sidebarAgents} />
          <SidebarInset>{children}</SidebarInset>
        </SidebarProvider>
      </SessionsProvider>
    </>
  );
}
