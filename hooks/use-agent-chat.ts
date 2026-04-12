"use client";

import { useState, useCallback, useRef } from "react";

export interface ToolCall {
  id: string;
  name: string;
  state: "running" | "completed";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  toolCalls?: ToolCall[];
  isThinking?: boolean;
}

type Status = "idle" | "streaming";

interface SSEEvent {
  type: "text" | "tool_use" | "tool_result" | "thinking" | "done" | "error";
  text?: string;
  id?: string;
  name?: string;
  message?: string;
}

export function useAgentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const sessionIdRef = useRef<string | null>(null);

  const sendMessage = useCallback(async (text: string) => {
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
    };
    const assistantId = crypto.randomUUID();
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "assistant",
      text: "",
      toolCalls: [],
      isThinking: false,
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setStatus("streaming");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          sessionId: sessionIdRef.current,
        }),
      });

      const newSessionId = response.headers.get("X-Session-Id");
      if (newSessionId) {
        sessionIdRef.current = newSessionId;
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const event: SSEEvent = JSON.parse(line.slice(6));

          switch (event.type) {
            case "thinking": {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId
                    ? { ...msg, isThinking: true }
                    : msg,
                ),
              );
              break;
            }
            case "text": {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId
                    ? { ...msg, text: msg.text + event.text, isThinking: false }
                    : msg,
                ),
              );
              break;
            }
            case "tool_use": {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId
                    ? {
                        ...msg,
                        isThinking: false,
                        toolCalls: [
                          ...(msg.toolCalls ?? []),
                          {
                            id: event.id!,
                            name: event.name!,
                            state: "running" as const,
                          },
                        ],
                      }
                    : msg,
                ),
              );
              break;
            }
            case "tool_result": {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId
                    ? {
                        ...msg,
                        toolCalls: msg.toolCalls?.map((tc) =>
                          tc.id === event.id
                            ? { ...tc, state: "completed" as const }
                            : tc,
                        ),
                      }
                    : msg,
                ),
              );
              break;
            }
            case "done": {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId
                    ? { ...msg, isThinking: false }
                    : msg,
                ),
              );
              setStatus("idle");
              break;
            }
            case "error": {
              console.error("Agent error:", event.message);
              setStatus("idle");
              break;
            }
          }
        }
      }
    } catch (error) {
      console.error("Chat error:", error);
      setStatus("idle");
    }
  }, []);

  return { messages, status, sendMessage };
}
