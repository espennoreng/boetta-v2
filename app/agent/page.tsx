import { clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { requireActive } from "@/lib/auth";
import { makeQueries } from "@/lib/db/queries";
import { db } from "@/lib/db";
import {
  allowedAgentsFor,
  getAgent,
  type OrgType,
} from "@/lib/agents/registry";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const queries = makeQueries(db);

export default async function AgentLanding() {
  const ctx = await requireActive();

  const client = await clerkClient();
  const org = await client.organizations.getOrganization({
    organizationId: ctx.orgId,
  });
  const orgType = org.publicMetadata?.orgType as OrgType | undefined;
  const allowed = allowedAgentsFor(orgType);

  if (allowed.length === 0) {
    redirect("/");
  }

  if (allowed.length === 1) {
    redirect(`/agent/${allowed[0]}`);
  }

  // Multiple agents: prefer the user's most recent session's agent.
  const recent = await queries.listSessionsForOrg(ctx.orgId);
  const recentAgent = recent[0]?.agentType;
  if (recentAgent && allowed.includes(recentAgent)) {
    redirect(`/agent/${recentAgent}`);
  }

  // Multiple agents, no history — render picker.
  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold mb-6">Velg agent</h1>
      <div className="grid gap-4 md:grid-cols-2">
        {allowed.map((slug) => {
          const agent = getAgent(slug);
          const label = agent.ui?.newSessionLabel ?? slug;
          const group = agent.ui?.sessionGroupLabel ?? "";
          return (
            <Link key={slug} href={`/agent/${slug}`}>
              <Card className="hover:border-foreground transition-colors">
                <CardHeader>
                  <CardTitle>{label}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {group}
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
