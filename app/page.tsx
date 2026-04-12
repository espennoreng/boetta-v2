"use client";

import { MessageSquare, PaperclipIcon } from "lucide-react";
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
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from "@/components/ai-elements/attachments";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTools,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import { Tool, ToolHeader } from "@/components/ai-elements/tool";
import {
  Suggestions,
  Suggestion,
} from "@/components/ai-elements/suggestion";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { useAgentChat } from "@/hooks/use-agent-chat";
import type { ChatMessage, ToolCall } from "@/hooks/use-agent-chat";
import { memo, useCallback } from "react";

interface AttachmentItemProps {
  attachment: {
    id: string;
    type: "file";
    filename?: string;
    mediaType: string;
    url: string;
  };
  onRemove: (id: string) => void;
}

const AttachmentItem = memo(({ attachment, onRemove }: AttachmentItemProps) => {
  const handleRemove = useCallback(
    () => onRemove(attachment.id),
    [onRemove, attachment.id]
  );
  return (
    <Attachment
      data={attachment}
      key={attachment.id}
      onRemove={handleRemove}
      className="max-w-48"
    >
      <AttachmentPreview />
      <AttachmentInfo className="truncate" />
      <AttachmentRemove className="opacity-100" />
    </Attachment>
  );
});

AttachmentItem.displayName = "AttachmentItem";

const AttachFilesButton = () => {
  const attachments = usePromptInputAttachments();
  return (
    <PromptInputButton onClick={() => attachments.openFileDialog()}>
      <PaperclipIcon className="size-4" />
    </PromptInputButton>
  );
};

const PromptInputAttachmentsDisplay = () => {
  const attachments = usePromptInputAttachments();

  const handleRemove = useCallback(
    (id: string) => attachments.remove(id),
    [attachments]
  );

  if (attachments.files.length === 0) {
    return null;
  }

  return (
    <Attachments variant="inline" className="max-h-32 w-full self-start overflow-y-auto p-2">
      {attachments.files.map((attachment) => (
        <AttachmentItem
          attachment={attachment}
          key={attachment.id}
          onRemove={handleRemove}
        />
      ))}
    </Attachments>
  );
};

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
        <PromptInputProvider>
          <PromptInput
            globalDrop
            multiple
            onSubmit={({ text, files }) => {
              if ((!text.trim() && files.length === 0) || status === "streaming")
                return;
              sendMessage(text, files);
            }}
          >
            <PromptInputAttachmentsDisplay />
            <PromptInputBody>
              <PromptInputTextarea placeholder="Send a message..." />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                <AttachFilesButton />
              </PromptInputTools>
              <PromptInputSubmit
                status={status === "streaming" ? "streaming" : "ready"}
              />
            </PromptInputFooter>
          </PromptInput>
        </PromptInputProvider>
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
        {message.files && message.files.length > 0 && (
          <Attachments variant="inline" className="mb-1 justify-end">
            {message.files.map((file, i) => (
              <Attachment key={i} data={{ ...file, id: String(i) }}>
                <AttachmentPreview />
                <AttachmentInfo />
              </Attachment>
            ))}
          </Attachments>
        )}
        {message.text && <MessageContent>{message.text}</MessageContent>}
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
