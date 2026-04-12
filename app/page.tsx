"use client";

import { MessageSquare } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
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
  Reasoning,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
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
            <ConversationEmptyState
              title="Chat with Claude"
              description="Send a message to start a conversation."
              icon={<MessageSquare className="size-8" />}
            >
              <Suggestions className="mt-4 justify-center">
                {SUGGESTIONS.map((s) => (
                  <Suggestion
                    key={s}
                    suggestion={s}
                    onClick={(text) => sendMessage(text)}
                  />
                ))}
              </Suggestions>
            </ConversationEmptyState>
          ) : (
            messages.map((msg) => (
              <ChatMessageItem key={msg.id} message={msg} />
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
            <PromptInputTextarea placeholder="Send a message..." />
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

function ChatMessageItem({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <Message from="user">
        <MessageContent>{message.text}</MessageContent>
      </Message>
    );
  }

  const isStreaming = message.isThinking || false;
  const hasContent = message.text || message.toolCalls?.length;

  return (
    <Message from="assistant">
      {isStreaming && !hasContent && (
        <Shimmer as="p" className="text-sm text-muted-foreground">
          Thinking...
        </Shimmer>
      )}
      {(isStreaming || message.text) && hasContent && (
        <Reasoning isStreaming={isStreaming}>
          <ReasoningTrigger />
        </Reasoning>
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
