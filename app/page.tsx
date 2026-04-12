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
  AttachmentHoverCard,
  AttachmentHoverCardContent,
  AttachmentHoverCardTrigger,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
  getAttachmentLabel,
  getMediaCategory,
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
import { Tool, ToolHeader, ToolContent, ToolOutput } from "@/components/ai-elements/tool";
import {
  Suggestions,
  Suggestion,
} from "@/components/ai-elements/suggestion";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { useAgentChat } from "@/hooks/use-agent-chat";
import type { ChatMessage, ToolCall } from "@/hooks/use-agent-chat";
import { memo, useCallback, useMemo } from "react";

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
  const mediaCategory = getMediaCategory(attachment);
  const label = getAttachmentLabel(attachment);

  return (
    <AttachmentHoverCard key={attachment.id}>
      <AttachmentHoverCardTrigger>
        <Attachment data={attachment} onRemove={handleRemove} className="max-w-48">
          <div className="relative size-5 shrink-0">
            <div className="absolute inset-0 transition-opacity group-hover:opacity-0">
              <AttachmentPreview />
            </div>
            <AttachmentRemove className="absolute inset-0" />
          </div>
          <AttachmentInfo />
        </Attachment>
      </AttachmentHoverCardTrigger>
      <AttachmentHoverCardContent>
        <div className="space-y-3">
          {mediaCategory === "image" && attachment.url && (
            <div className="flex max-h-96 w-80 items-center justify-center overflow-hidden rounded-md border">
              <img
                alt={label}
                className="max-h-full max-w-full object-contain"
                height={384}
                src={attachment.url}
                width={320}
              />
            </div>
          )}
          <div className="space-y-1 px-0.5">
            <h4 className="font-semibold text-sm leading-none">{label}</h4>
            {attachment.mediaType && (
              <p className="font-mono text-muted-foreground text-xs">
                {attachment.mediaType}
              </p>
            )}
          </div>
        </div>
      </AttachmentHoverCardContent>
    </AttachmentHoverCard>
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

const SVAR_PATTERN = /\[svar:\s*(.+?)\]/g;

function parseAnswerOptions(text: string): {
  cleanText: string;
  options: string[];
} {
  const options: string[] = [];
  let match;
  while ((match = SVAR_PATTERN.exec(text)) !== null) {
    options.push(match[1].trim());
  }
  const cleanText = text.replace(SVAR_PATTERN, "").trimEnd();
  return { cleanText, options };
}

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
                <h3 className="font-medium text-sm">Boetta</h3>
                <p className="text-muted-foreground text-sm">
                  Last opp filer og still spørsmål for å komme i gang.
                </p>
              </div>
            </div>
          ) : (
            messages.map((msg, i) => (
              <ChatMessageItem
                key={msg.id}
                message={msg}
                isLast={i === messages.length - 1}
                isStreaming={status === "streaming"}
                onSendMessage={sendMessage}
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
  onSendMessage,
}: {
  message: ChatMessage;
  isLast: boolean;
  isStreaming: boolean;
  onSendMessage: (text: string) => void;
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
  const showInitialLoading = isLast && isStreaming && !hasContent;
  const showThinkingAfterTools =
    isLast && isStreaming && message.isThinking && !message.text;

  const { cleanText, options } = useMemo(
    () => (message.text ? parseAnswerOptions(message.text) : { cleanText: "", options: [] }),
    [message.text],
  );

  const showSuggestions = isLast && !isStreaming && options.length > 0;

  return (
    <Message from="assistant">
      {showInitialLoading && (
        <Shimmer as="p" className="text-sm">
          Thinking...
        </Shimmer>
      )}
      {message.toolCalls?.map((tc) => (
        <Tool key={tc.id}>
          <ToolHeader
            type="dynamic-tool"
            toolName={tc.name}
            state={toolStateToUIPart(tc.state)}
          />
          {tc.result && (
            <ToolContent>
              <ToolOutput output={tc.result} errorText={undefined} />
            </ToolContent>
          )}
        </Tool>
      ))}
      {showThinkingAfterTools && (
        <Shimmer as="p" className="text-sm">
          Analyserer...
        </Shimmer>
      )}
      {cleanText && (
        <MessageContent>
          <MessageResponse>{cleanText}</MessageResponse>
        </MessageContent>
      )}
      {showSuggestions && (
        <Suggestions className="mt-3 flex-wrap gap-2">
          {options.map((option) => (
            <Suggestion
              key={option}
              suggestion={option}
              onClick={(text) => onSendMessage(text)}
            />
          ))}
        </Suggestions>
      )}
    </Message>
  );
}
