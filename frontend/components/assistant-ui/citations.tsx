"use client";

import {
  CalendarIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  GlobeIcon,
  QuoteIcon,
} from "lucide-react";
import type { FC } from "react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { Citation } from "@/lib/chatApi";

type CitationsProps = {
  citations: Citation[];
};

type CitationGroup = {
  id: string;
  title: string;
  sourceUrl: string | null;
  snippets: Citation[];
  publishDate: string | null;
  domain: string | null;
};

const getDomain = (sourceUrl: string | null) => {
  if (!sourceUrl) return null;
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

const formatPublishDate = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // `undefined` locale → browser default. The faguquanji corpus is Chinese,
  // so hardcoding "en" makes dates read awkwardly for readers whose browser
  // is set to zh-TW / zh-CN.
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
};

export const dedupeAndGroupCitations = (
  citations: Citation[],
): CitationGroup[] => {
  const uniqueByChunk = new Map<string, Citation>();
  for (const citation of citations) {
    if (!uniqueByChunk.has(citation.chunk_id)) {
      uniqueByChunk.set(citation.chunk_id, citation);
    }
  }

  const groups = new Map<string, CitationGroup>();
  for (const citation of uniqueByChunk.values()) {
    const groupKey = citation.source_url ?? citation.title ?? citation.chunk_id;
    const existing = groups.get(groupKey);

    if (existing) {
      existing.snippets.push(citation);
      continue;
    }

    groups.set(groupKey, {
      id: groupKey,
      title: citation.title || "Untitled source",
      sourceUrl: citation.source_url,
      snippets: [citation],
      publishDate: formatPublishDate(citation.metadata.publish_date),
      domain: getDomain(citation.source_url),
    });
  }

  return Array.from(groups.values());
};

export const Citations: FC<CitationsProps> = ({ citations }) => {
  const groups = dedupeAndGroupCitations(citations);
  if (groups.length === 0) return null;

  return (
    <Collapsible className="mt-5 overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-b from-muted/40 to-background">
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="group flex h-auto w-full items-center justify-between rounded-none px-4 py-3 text-left hover:bg-muted/40"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-foreground text-background">
              <QuoteIcon className="size-4" />
            </div>
            <div className="min-w-0">
              <div className="font-medium text-sm text-foreground">Sources</div>
              <div className="text-muted-foreground text-xs">
                {groups.length} source{groups.length === 1 ? "" : "s"} grounded
                this answer
              </div>
            </div>
          </div>
          <ChevronDownIcon className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border/60 px-4 py-4">
        <div className="space-y-3">
          {groups.map((group, index) => (
            <article
              key={group.id}
              className="rounded-2xl border border-border/70 bg-background/90 p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-muted px-2 py-1 font-medium text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                      Source {index + 1}
                    </span>
                    {group.domain ? (
                      <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                        <GlobeIcon className="size-3" />
                        {group.domain}
                      </span>
                    ) : null}
                    {group.publishDate ? (
                      <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                        <CalendarIcon className="size-3" />
                        {group.publishDate}
                      </span>
                    ) : null}
                  </div>
                  <h4 className="mt-2 line-clamp-2 font-medium text-base text-foreground">
                    {group.title}
                  </h4>
                </div>
                {group.sourceUrl ? (
                  <a
                    href={group.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-muted-foreground text-xs transition-colors hover:border-foreground/30 hover:text-foreground"
                  >
                    Open
                    <ExternalLinkIcon className="size-3" />
                  </a>
                ) : null}
              </div>

              <div className="mt-4 space-y-2">
                {group.snippets.map((citation) => (
                  <blockquote
                    key={citation.chunk_id}
                    className="rounded-2xl border-l-4 border-foreground/60 bg-muted/45 px-3 py-3 text-muted-foreground text-sm leading-6"
                  >
                    {citation.text}
                  </blockquote>
                ))}
              </div>
            </article>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
