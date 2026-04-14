"use client";

import { CircleHelp, MessageSquare, PaperclipIcon } from "lucide-react";
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
import { CitationRenderer } from "@/components/citation-renderer";
import { useAgentChat } from "@/hooks/use-agent-chat";
import type { ChatMessage, ToolCall, MessagePart } from "@/hooks/use-agent-chat";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useSessions } from "@/app/agent/_components/sessions-provider";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

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

const AttachFilesButton = ({ sessionId }: { sessionId?: string | null }) => {
  const attachments = usePromptInputAttachments();
  const noSession = !sessionId;
  return (
    <PromptInputButton
      disabled={noSession}
      tooltip={noSession ? "Send en tekstmelding først for å starte samtalen, deretter kan du legge ved filer." : undefined}
      onClick={noSession ? undefined : () => attachments.openFileDialog()}
    >
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
  bodyText: string;
  questionText: string | null;
  options: string[];
} {
  const options: string[] = [];
  let match;
  while ((match = SVAR_PATTERN.exec(text)) !== null) {
    options.push(match[1].trim());
  }
  const cleanText = text.replace(SVAR_PATTERN, "").trimEnd();

  if (options.length === 0) {
    return { bodyText: cleanText, questionText: null, options };
  }

  // Split off the last paragraph as the question
  const lastDoubleNewline = cleanText.lastIndexOf("\n\n");
  if (lastDoubleNewline === -1) {
    return { bodyText: "", questionText: cleanText, options };
  }

  return {
    bodyText: cleanText.slice(0, lastDoubleNewline).trimEnd(),
    questionText: cleanText.slice(lastDoubleNewline + 2).trim(),
    options,
  };
}

const THINKING_PHRASES = [
  "Tenker...",
  "Hmm...",
  "Grubler...",
  "Funderer...",
  "La meg se...",
  "Et øyeblikk...",
  "Vurderer...",
  "Leser nøye...",
  "Blar gjennom lovverket...",
  "Setter på kaffevannet...",
];

const ANALYZING_PHRASES = [
  "Analyserer...",
  "Sjekker detaljer...",
  "Fordøyer resultater...",
  "Nesten der...",
  "Kobler sammen trådene...",
  "Dobbeltsjekker...",
  "Leser mellom linjene...",
  "Regner og tenker...",
  "Blar i paragrafene...",
  "Skriver med begge hender...",
];

function useRotatingPhrase(phrases: string[], intervalMs = 3000): string {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * phrases.length));
  const phrasesRef = useRef(phrases);
  phrasesRef.current = phrases;

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((prev) => {
        let next: number;
        do {
          next = Math.floor(Math.random() * phrasesRef.current.length);
        } while (next === prev && phrasesRef.current.length > 1);
        return next;
      });
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return phrases[index];
}

function QuestionCard({
  question,
  options,
  onAnswer,
}: {
  question: string;
  options: string[];
  onAnswer: (text: string) => void;
}) {
  return (
    <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900 dark:bg-blue-950/30">
      <div className="mb-2 flex items-center gap-2 text-blue-700 dark:text-blue-400">
        <CircleHelp className="size-4 shrink-0" />
        <span className="text-xs font-medium uppercase tracking-wide">
          Spørsmål
        </span>
      </div>
      <div className="text-sm">
        <MessageResponse>{question}</MessageResponse>
      </div>
      {options.length > 0 && (
        <Suggestions className="mt-3 flex-wrap gap-2">
          {options.map((option) => (
            <Suggestion
              key={option}
              suggestion={option}
              onClick={(text) => onAnswer(text)}
            />
          ))}
        </Suggestions>
      )}
    </div>
  );
}

interface ChatPageProps {
  initialSessionId?: string | null;
  initialMessages?: ChatMessage[];
}

export default function ChatPage({ initialSessionId, initialMessages }: ChatPageProps) {
  const { refresh, applyTitle, upsertPlaceholder } = useSessions();

  const handleSessionCreated = useCallback(
    (sessionId: string) => {
      upsertPlaceholder(sessionId);
      void refresh();
    },
    [refresh, upsertPlaceholder],
  );

  const handleTitleUpdate = useCallback(
    (sessionId: string, title: string) => {
      applyTitle(sessionId, title);
    },
    [applyTitle],
  );

  const { messages, status, sendMessage, sessionId } = useAgentChat({
    initialSessionId,
    initialMessages,
    onSessionCreated: handleSessionCreated,
    onTitleUpdate: handleTitleUpdate,
  });

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <SidebarTrigger />
      </header>
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
            accept="application/pdf,image/png,image/jpeg,image/webp"
            globalDrop
            multiple
            sessionId={sessionId ?? undefined}
            onSubmit={({ text, attachmentIds }) => {
              if ((!text.trim() && attachmentIds.length === 0) || status === "streaming")
                return;
              if (attachmentIds.length > 0 && !sessionId) {
                // Defense-in-depth: attach button is already disabled without a sessionId,
                // but guard here as well in case files slip through another path.
                console.error("Cannot upload attachments before a session exists. Send a text message first.");
                return;
              }
              sendMessage(text, attachmentIds);
            }}
          >
            <PromptInputAttachmentsDisplay />
            <PromptInputBody>
              <PromptInputTextarea placeholder="Skriv en melding..." />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                <AttachFilesButton sessionId={sessionId} />
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
        {message.attachmentIds && message.attachmentIds.length > 0 && (
          <div className="mb-1 flex flex-wrap justify-end gap-1">
            {message.attachmentIds.map((id) => (
              <a
                key={id}
                href={`/api/files/${id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <PaperclipIcon className="size-3" />
                vedlegg
              </a>
            ))}
          </div>
        )}
        {message.text && <MessageContent>{message.text}</MessageContent>}
      </Message>
    );
  }

  const hasContent = message.text || (message.toolCalls?.length ?? 0) > 0;
  const showInitialLoading = isLast && isStreaming && !hasContent;
  const showThinking = isLast && isStreaming && message.isThinking;

  const thinkingPhrase = useRotatingPhrase(THINKING_PHRASES);
  const analyzingPhrase = useRotatingPhrase(ANALYZING_PHRASES);

  const { bodyText, questionText, options } = useMemo(
    () =>
      message.text
        ? parseAnswerOptions(message.text)
        : { bodyText: "", questionText: null, options: [] },
    [message.text],
  );

  const showQuestion = isLast && !isStreaming && questionText;

  const toolCallsMap = useMemo(() => {
    const map = new Map<string, ToolCall>();
    for (const tc of message.toolCalls ?? []) {
      map.set(tc.id, tc);
    }
    return map;
  }, [message.toolCalls]);

  // Use parts array for correct ordering if available, otherwise fall back
  const hasParts = message.parts && message.parts.length > 0;

  return (
    <Message from="assistant">
      {showInitialLoading && (
        <Shimmer as="p" className="text-sm">
          {thinkingPhrase}
        </Shimmer>
      )}
      {hasParts ? (
        // Render in the order events actually arrived
        message.parts!.map((part, i) => {
          if (part.type === "tool") {
            const tc = toolCallsMap.get(part.toolCallId);
            if (!tc) return null;
            return (
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
            );
          }
          // text part — strip [svar:] tags; question is rendered separately via QuestionCard
          const { bodyText: partBody } = parseAnswerOptions(part.text);
          return partBody ? (
            <MessageContent key={`text-${i}`}>
              {message.citations && message.citations.length > 0 ? (
                <CitationRenderer citations={message.citations}>
                  {partBody}
                </CitationRenderer>
              ) : (
                <MessageResponse>{partBody}</MessageResponse>
              )}
            </MessageContent>
          ) : null;
        })
      ) : (
        // Fallback: tools then text (legacy / streaming without parts)
        <>
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
          {bodyText && (
            <MessageContent>
              {message.citations && message.citations.length > 0 ? (
                <CitationRenderer citations={message.citations}>
                  {bodyText}
                </CitationRenderer>
              ) : (
                <MessageResponse>{bodyText}</MessageResponse>
              )}
            </MessageContent>
          )}
        </>
      )}
      {showThinking && (
        <Shimmer as="p" className="text-sm">
          {analyzingPhrase}
        </Shimmer>
      )}
      {showQuestion && (
        <QuestionCard
          question={questionText}
          options={options}
          onAnswer={onSendMessage}
        />
      )}
    </Message>
  );
}
