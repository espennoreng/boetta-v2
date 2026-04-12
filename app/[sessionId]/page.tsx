"use client";

import { use, useEffect, useState } from "react";
import ChatPage from "@/components/chat-page";
import type { ChatMessage } from "@/hooks/use-agent-chat";
import { Shimmer } from "@/components/ai-elements/shimmer";

export default function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = use(params);
  const [initialMessages, setInitialMessages] = useState<ChatMessage[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSession() {
      try {
        const res = await fetch(`/api/session/${sessionId}`);
        if (!res.ok) {
          const data = await res.json();
          setError(data.error ?? "Failed to load session");
          return;
        }
        const data = await res.json();
        setInitialMessages(data.messages);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load session");
      }
    }
    loadSession();
  }, [sessionId]);

  if (error) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="space-y-2 text-center">
          <p className="text-sm text-muted-foreground">{error}</p>
          <a href="/" className="text-sm underline">
            Start a new conversation
          </a>
        </div>
      </div>
    );
  }

  if (initialMessages === null) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Shimmer as="p" className="text-sm">
          Loading conversation...
        </Shimmer>
      </div>
    );
  }

  return (
    <ChatPage initialSessionId={sessionId} initialMessages={initialMessages} />
  );
}
