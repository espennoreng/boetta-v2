"use client";

import { MessageSquare } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputBody,
} from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";
import { Tool, ToolHeader } from "@/components/ai-elements/tool";
import {
  Suggestions,
  Suggestion,
} from "@/components/ai-elements/suggestion";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { useAgentChat } from "@/hooks/use-agent-chat";
import type { ChatMessage, ToolCall } from "@/hooks/use-agent-chat";

function toolStateToUIPart(state: ToolCall["state"]) {
  return state === "running" ? "input-available" : "output-available";
}

const SUGGESTIONS = [
  "Write a Python script that generates Fibonacci numbers",
  "Explain how async/await works in JavaScript",
  "Create a simple REST API with Express",
];

export default function ChatPage() {
  const { messages, status, sendMessage } = useAgentChat();

  return (
    <div className="flex h-dvh flex-col">
      <Conversation className="flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl">
          {messages.length === 0 ? (
            <div className="flex size-full flex-col items-center justify-center gap-4 p-8 text-center">
              <div className="text-muted-foreground">
                <MessageSquare className="size-8" />
              </div>
              <div className="space-y-1">
                <h3 className="font-medium text-sm">Chat with Claude</h3>
                <p className="text-muted-foreground text-sm">
                  Send a message to start a conversation.
                </p>
              </div>
              <Suggestions className="mt-2 justify-center">
                {SUGGESTIONS.map((s) => (
                  <Suggestion
                    key={s}
                    suggestion={s}
                    onClick={(text) => sendMessage(text)}
                  />
                ))}
              </Suggestions>
            </div>
          ) : (
            messages.map((msg, i) => (
              <ChatMessageItem
                key={msg.id}
                message={msg}
                isLast={i === messages.length - 1}
                isStreaming={status === "streaming"}
              />
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="mx-auto w-full max-w-3xl px-4 pb-4">
        <PromptInput
          onSubmit={async ({ text }) => {
            if (!text.trim() || status === "streaming") return;
            await sendMessage(text);
          }}
        >
          <PromptInputBody>
            <PromptInputTextarea placeholder="Send a message..." className="min-h-0" />
            <Button
              type="submit"
              size="icon"
              variant="ghost"
              disabled={status === "streaming"}
              className="shrink-0"
            >
              <Send className="size-4" />
            </Button>
          </PromptInputBody>
        </PromptInput>
      </div>
    </div>
  );
}

function ChatMessageItem({
  message,
  isLast,
  isStreaming,
}: {
  message: ChatMessage;
  isLast: boolean;
  isStreaming: boolean;
}) {
  if (message.role === "user") {
    return (
      <Message from="user">
        <MessageContent>{message.text}</MessageContent>
      </Message>
    );
  }

  const hasContent = message.text || (message.toolCalls?.length ?? 0) > 0;
  const showLoading = isLast && isStreaming && !hasContent;

  return (
    <Message from="assistant">
      {showLoading && (
        <Shimmer as="p" className="text-sm">
          Thinking...
        </Shimmer>
      )}
      {message.text && (
        <MessageContent>
          <MessageResponse>{message.text}</MessageResponse>
        </MessageContent>
      )}
      {message.toolCalls?.map((tc) => (
        <Tool key={tc.id}>
          <ToolHeader
            type="dynamic-tool"
            toolName={tc.name}
            state={toolStateToUIPart(tc.state)}
          />
        </Tool>
      ))}
    </Message>
  );
}
