import { createSession } from "@/lib/agent-manager";
import { requireActive, type CurrentContext } from "@/lib/auth";
import { makeAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { clerkClient } from "@clerk/nextjs/server";
import { allowedAgentsFor, type OrgType } from "@/lib/agents/registry";

const audit = makeAudit(db);

export async function POST(request: Request) {
  let ctx: CurrentContext;
  try {
    ctx = await requireActive();
  } catch (err) {
    const status = err instanceof Error && err.name === "NotActiveError" ? 403 : 401;
    return Response.json(
      { error: err instanceof Error ? err.message : "Unauthorized" },
      { status },
    );
  }

  let body: { agentType?: string; title?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const agentType = body.agentType;
  if (typeof agentType !== "string" || agentType.length === 0) {
    return Response.json({ error: "agentType required" }, { status: 400 });
  }

  // Look up org type from Clerk and check the requested agent is allowed
  const client = await clerkClient();
  const org = await client.organizations.getOrganization({
    organizationId: ctx.orgId,
  });
  const orgType = org.publicMetadata?.orgType as OrgType | undefined;
  const allowed = allowedAgentsFor(orgType);
  if (!allowed.includes(agentType)) {
    return Response.json(
      { error: `Agent ${agentType} not allowed for this org` },
      { status: 400 },
    );
  }

  const sessionId = await createSession({
    agentType,
    clerkOrgId: ctx.orgId,
    clerkUserId: ctx.userId,
    title: body.title,
  });

  await audit.logEvent({
    actorUserId: ctx.userId,
    actorOrgId: ctx.orgId,
    event: "session.created",
    subjectType: "session",
    subjectId: sessionId,
  });

  return Response.json({ sessionId });
}
