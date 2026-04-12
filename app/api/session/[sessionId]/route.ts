import Anthropic from "@anthropic-ai/sdk";
import { getAgent } from "@/lib/agents/registry";
import type { MessagePart } from "@/hooks/use-agent-chat";

const client = new Anthropic();
const agentModule = getAgent("byggesak");

interface ReconstructedMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
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

  try {
    const session = await client.beta.sessions.retrieve(sessionId);
    if (session.status === "terminated") {
      return Response.json(
        { error: "Session has been terminated" },
        { status: 410 },
      );
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

          messages.push({
            id: event.id,
            role: "user",
            text,
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
