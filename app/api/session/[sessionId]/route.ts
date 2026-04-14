import Anthropic from "@anthropic-ai/sdk";
import { getAgent } from "@/lib/agents/registry";
import type { MessagePart } from "@/hooks/use-agent-chat";
import { requireActive } from "@/lib/auth";
import { makeQueries } from "@/lib/db/queries";
import { db } from "@/lib/db";

const client = new Anthropic();
const agentModule = getAgent("byggesak");
const queries = makeQueries(db);

interface ReconstructedMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachmentIds?: string[];
  attachmentNames?: string[];
  toolCalls?: Array<{
    id: string;
    name: string;
    state: "running" | "completed";
    result?: string;
  }>;
  parts?: MessagePart[];
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  let ctx;
  try {
    ctx = await requireActive();
  } catch (err) {
    const status = err instanceof Error && err.name === "NotActiveError" ? 403 : 401;
    return Response.json(
      { error: err instanceof Error ? err.message : "Unauthorized" },
      { status },
    );
  }

  const ownership = await queries.getSessionOwnership(sessionId);
  if (!ownership || ownership.clerkOrgId !== ctx.orgId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const session = await client.beta.sessions.retrieve(sessionId);
    if (session.status === "terminated") {
      return Response.json(
        { error: "Session has been terminated" },
        { status: 410 },
      );
    }

    const attachmentRows = await queries.getAttachmentsBySession({
      anthropicSessionId: sessionId,
      clerkOrgId: ctx.orgId,
    });
    const fileIdToAttachment = new Map<
      string,
      { id: string; originalName: string }
    >();
    for (const row of attachmentRows) {
      if (row.anthropicFileId) {
        fileIdToAttachment.set(row.anthropicFileId, {
          id: row.id,
          originalName: row.originalName,
        });
      }
    }

    const messages: ReconstructedMessage[] = [];
    let currentAssistant: ReconstructedMessage | null = null;

    function flushAssistant() {
      if (currentAssistant) {
        messages.push(currentAssistant);
        currentAssistant = null;
      }
    }

    for await (const event of client.beta.sessions.events.list(sessionId, {
      order: "asc",
    })) {
      switch (event.type) {
        case "user.message": {
          flushAssistant();

          const text = event.content
            .filter((b): b is { type: "text"; text: string } => b.type === "text")
            .map((b) => b.text)
            .join("");

          const attachmentIds: string[] = [];
          const attachmentNames: string[] = [];
          for (const block of event.content) {
            if (
              (block.type === "image" || block.type === "document") &&
              block.source?.type === "file" &&
              typeof block.source.file_id === "string"
            ) {
              const att = fileIdToAttachment.get(block.source.file_id);
              if (att) {
                attachmentIds.push(att.id);
                attachmentNames.push(att.originalName);
              }
            }
          }

          messages.push({
            id: event.id,
            role: "user",
            text,
            ...(attachmentIds.length > 0 ? { attachmentIds, attachmentNames } : {}),
          });
          break;
        }

        case "agent.message": {
          if (!currentAssistant) {
            currentAssistant = {
              id: event.id,
              role: "assistant",
              text: "",
              toolCalls: [],
              parts: [],
            };
          }
          const text = event.content
            .filter((b): b is { type: "text"; text: string } => b.type === "text")
            .map((b) => b.text)
            .join("");
          if (text) {
            currentAssistant.text += text;
            // Append to last text part or create new one
            const parts = currentAssistant.parts!;
            const lastPart = parts[parts.length - 1];
            if (lastPart?.type === "text") {
              lastPart.text += text;
            } else {
              parts.push({ type: "text", text });
            }
          }
          break;
        }

        case "agent.tool_use":
        case "agent.custom_tool_use": {
          if (!currentAssistant) {
            currentAssistant = {
              id: event.id,
              role: "assistant",
              text: "",
              toolCalls: [],
              parts: [],
            };
          }
          const toolEvent = event as { id: string; name: string; input?: Record<string, unknown> };
          const displayName = agentModule.getDisplayName(toolEvent.name, toolEvent.input);
          currentAssistant.toolCalls!.push({
            id: toolEvent.id,
            name: displayName ?? toolEvent.name,
            state: "completed",
          });
          currentAssistant.parts!.push({
            type: "tool",
            toolCallId: toolEvent.id,
          });
          break;
        }

        case "agent.tool_result": {
          if (currentAssistant) {
            const resultEvent = event as {
              tool_use_id: string;
              content?: Array<{ type: string; text?: string }>;
            };
            const tc = currentAssistant.toolCalls!.find(
              (t) => t.id === resultEvent.tool_use_id,
            );
            if (tc && resultEvent.content) {
              tc.result = resultEvent.content
                .filter((b) => b.type === "text" && b.text)
                .map((b) => b.text!)
                .join("");
            }
          }
          break;
        }

        case "user.custom_tool_result": {
          if (currentAssistant) {
            const resultEvent = event as {
              custom_tool_use_id: string;
              content?: Array<{ type: string; text?: string }>;
            };
            const tc = currentAssistant.toolCalls!.find(
              (t) => t.id === resultEvent.custom_tool_use_id,
            );
            if (tc && resultEvent.content) {
              tc.result = resultEvent.content
                .filter((b) => b.type === "text" && b.text)
                .map((b) => b.text!)
                .join("");
            }
          }
          break;
        }
      }
    }

    flushAssistant();

    return Response.json({ messages, status: session.status });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
