"use client";

import { createContext, useContext, useMemo } from "react";
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
import {
  findCitationsInText,
  buildCitationRegistry,
  normalizeLovhjemmel,
} from "@/lib/citations";

// Context to pass citation metadata to the custom link renderer
const CitationContext = createContext<Map<string, Citation>>(new Map());

/**
 * Custom <a> component for Streamdown. When a link points to lovdata.no,
 * renders an InlineCitation hover card. Otherwise renders a normal link.
 */
function CitationLink({
  href,
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const registry = useContext(CitationContext);

  if (href?.includes("lovdata.no")) {
    const decodedHref = decodeURIComponent(href);
    const citation = registry.get(href) ?? registry.get(decodedHref);

    return (
      <InlineCitation>
        <InlineCitationText>{children}</InlineCitationText>
        <InlineCitationCard>
          <InlineCitationCardTrigger
            sources={[href]}
            onClick={() => window.open(href, "_blank")}
            className="cursor-pointer"
          />
          <InlineCitationCardBody>
            <div className="space-y-2 p-4">
              <InlineCitationSource
                title={citation?.checkpoint}
                url={href}
                description={citation?.description}
              />
            </div>
          </InlineCitationCardBody>
        </InlineCitationCard>
      </InlineCitation>
    );
  }

  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}

const citationComponents = { a: CitationLink };

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

  const processedText = useMemo(() => {
    const matches = findCitationsInText(text, registry);
    if (matches.length === 0) return text;

    // Replace matched law references with markdown links (only if they have URLs)
    let result = "";
    let lastEnd = 0;
    for (const match of matches) {
      if (!match.citation.url) continue;
      result += text.slice(lastEnd, match.start);
      result += `[${match.matchedText}](${match.citation.url})`;
      lastEnd = match.end;
    }
    result += text.slice(lastEnd);
    return result;
  }, [text, registry]);

  // Build a URL-keyed lookup for the custom link renderer
  const urlRegistry = useMemo(() => {
    const map = new Map<string, Citation>();
    for (const c of registry.values()) {
      if (c.url) map.set(c.url, c);
    }
    return map;
  }, [registry]);

  return (
    <CitationContext.Provider value={urlRegistry}>
      <MessageResponse components={citationComponents}>
        {processedText}
      </MessageResponse>
    </CitationContext.Provider>
  );
}
