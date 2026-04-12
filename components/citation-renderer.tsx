"use client";

import { useMemo } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import {
  InlineCitation,
  InlineCitationText,
  InlineCitationCard,
  InlineCitationCardTrigger,
  InlineCitationCardBody,
  InlineCitationSource,
} from "@/components/ai-elements/inline-citation";
import type { Citation } from "@/lib/citations";
import { findCitationsInText, buildCitationRegistry } from "@/lib/citations";

interface CitationRendererProps {
  children: string;
  citations: Citation[];
}

export function CitationRenderer({
  children: text,
  citations,
}: CitationRendererProps) {
  const registry = useMemo(
    () => buildCitationRegistry(citations),
    [citations],
  );

  const matches = useMemo(
    () => findCitationsInText(text, registry),
    [text, registry],
  );

  if (matches.length === 0) {
    return <MessageResponse>{text}</MessageResponse>;
  }

  // Split the text into segments: plain text and citation matches
  const segments: Array<
    | { type: "text"; content: string }
    | { type: "citation"; matchedText: string; citation: Citation }
  > = [];

  let lastEnd = 0;
  for (const match of matches) {
    if (match.start > lastEnd) {
      segments.push({ type: "text", content: text.slice(lastEnd, match.start) });
    }
    segments.push({
      type: "citation",
      matchedText: match.matchedText,
      citation: match.citation,
    });
    lastEnd = match.end;
  }
  if (lastEnd < text.length) {
    segments.push({ type: "text", content: text.slice(lastEnd) });
  }

  return (
    <div>
      {segments.map((seg, i) => {
        if (seg.type === "text") {
          return <MessageResponse key={i}>{seg.content}</MessageResponse>;
        }
        return (
          <InlineCitation key={i}>
            <InlineCitationText>{seg.matchedText}</InlineCitationText>
            <InlineCitationCard>
              <InlineCitationCardTrigger
                sources={seg.citation.url ? [seg.citation.url] : []}
              />
              <InlineCitationCardBody>
                <div className="p-4 space-y-2">
                  <InlineCitationSource
                    title={seg.citation.checkpoint}
                    url={seg.citation.url || undefined}
                    description={seg.citation.description}
                  />
                </div>
              </InlineCitationCardBody>
            </InlineCitationCard>
          </InlineCitation>
        );
      })}
    </div>
  );
}
