import { redirect } from "next/navigation";
import { requireActive } from "@/lib/auth";
import { makeQueries } from "@/lib/db/queries";
import { db } from "@/lib/db";
import SessionClient from "./session-client";

const queries = makeQueries(db);

export default async function SlugScopedSessionPage({
  params,
}: {
  params: Promise<{ slug: string; sessionId: string }>;
}) {
  const { slug, sessionId } = await params;
  const ctx = await requireActive();

  const ownership = await queries.getSessionOwnership(sessionId);
  if (!ownership || ownership.clerkOrgId !== ctx.orgId) {
    redirect("/agent");
  }

  if (ownership.agentType !== slug) {
    redirect(`/agent/${ownership.agentType}/${sessionId}`);
  }

  return <SessionClient sessionId={sessionId} agentType={slug} />;
}
