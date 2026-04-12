import { createSession, sendMessageAndStream } from "@/lib/agent-manager";

export async function POST(request: Request) {
  const { message, sessionId: existingSessionId } = (await request.json()) as {
    message: string;
    sessionId?: string;
  };

  const sessionId = existingSessionId ?? (await createSession());
  const stream = await sendMessageAndStream(sessionId, message);

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          let data: string | null = null;

          switch (event.type) {
            case "agent.message": {
              const text = event.content
                .filter(
                  (block: { type: string }) => block.type === "text",
                )
                .map((block: { text: string }) => block.text)
                .join("");
              if (text) {
                data = JSON.stringify({ type: "text", text });
              }
              break;
            }
            case "agent.thinking": {
              data = JSON.stringify({ type: "thinking" });
              break;
            }
            case "agent.tool_use": {
              data = JSON.stringify({
                type: "tool_use",
                id: event.id,
                name: event.name,
              });
              break;
            }
            case "agent.tool_result": {
              data = JSON.stringify({
                type: "tool_result",
                id: event.tool_use_id,
              });
              break;
            }
            case "session.status_idle": {
              data = JSON.stringify({ type: "done" });
              break;
            }
          }

          if (data) {
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }

          if (event.type === "session.status_idle") {
            break;
          }
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Session-Id": sessionId,
    },
  });
}
