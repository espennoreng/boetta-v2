import { createSession } from "@/lib/agent-manager";
import { requireActive, type CurrentContext } from "@/lib/auth";
import { makeAudit } from "@/lib/audit";
import { db } from "@/lib/db";

const audit = makeAudit(db);

export async function POST() {
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

  const sessionId = await createSession({
    clerkOrgId: ctx.orgId,
    clerkUserId: ctx.userId,
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
