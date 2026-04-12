"use client";

import type { FileUIPart } from "ai";
import { useState, useCallback, useRef } from "react";
import type { Citation } from "@/lib/citations";

export interface ToolCall {
  id: string;
  name: string;
  state: "running" | "completed";
  result?: string;
}

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "tool"; toolCallId: string };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  files?: FileUIPart[];
  toolCalls?: ToolCall[];
  parts?: MessagePart[];
  isThinking?: boolean;
  citations?: Citation[];
}

type Status = "idle" | "streaming";

interface SSEEvent {
  type: "text" | "tool_use" | "tool_result" | "thinking" | "citations" | "done" | "error";
  text?: string;
  id?: string;
  name?: string;
  displayName?: string;
  result?: string;
  message?: string;
  citations?: Citation[];
}

interface UseAgentChatOptions {
  initialSessionId?: string | null;
  initialMessages?: ChatMessage[];
}

export function useAgentChat(options: UseAgentChatOptions = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>(
    options.initialMessages ?? [],
  );
  const [status, setStatus] = useState<Status>("idle");
  const sessionIdRef = useRef<string | null>(
    options.initialSessionId ?? null,
  );

  const sendMessage = useCallback(async (text: string, files: FileUIPart[] = []) => {
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
      ...(files.length > 0 ? { files } : {}),
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
          ...(files.length > 0 ? { files } : {}),
        }),
      });

      const newSessionId = response.headers.get("X-Session-Id");
      if (newSessionId) {
        sessionIdRef.current = newSessionId;
        // Update URL to include session ID so it can be restored
        if (typeof window !== "undefined" && !window.location.pathname.includes(newSessionId)) {
          window.history.replaceState(null, "", `/${newSessionId}`);
        }
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
                prev.map((msg) => {
                  if (msg.id !== assistantId) return msg;
                  const parts = msg.parts ?? [];
                  const lastPart = parts[parts.length - 1];
                  // Append to existing text part or create a new one
                  const newParts =
                    lastPart?.type === "text"
                      ? [
                          ...parts.slice(0, -1),
                          { type: "text" as const, text: lastPart.text + event.text },
                        ]
                      : [...parts, { type: "text" as const, text: event.text! }];
                  return {
                    ...msg,
                    text: msg.text + event.text,
                    parts: newParts,
                    isThinking: false,
                  };
                }),
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
                            name: event.displayName ?? event.name!,
                            state: "running" as const,
                          },
                        ],
                        parts: [
                          ...(msg.parts ?? []),
                          { type: "tool" as const, toolCallId: event.id! },
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
                        isThinking: true,
                        toolCalls: msg.toolCalls?.map((tc) =>
                          tc.id === event.id
                            ? {
                                ...tc,
                                state: "completed" as const,
                                ...(event.result ? { result: event.result } : {}),
                              }
                            : tc,
                        ),
                      }
                    : msg,
                ),
              );
              break;
            }
            case "citations": {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId
                    ? { ...msg, citations: event.citations }
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

export type { Citation } from "@/lib/citations";
