import type { SerializableCitation } from "@/components/tool-ui/citation";
import type { Citation } from "@/lib/chatApi";

/**
 * Backend emits one citation per retrieved chunk. tool-ui's CitationList
 * wants one entry per *source* (so the stacked variant shows N unique
 * sources, not N chunks). This adapter:
 *
 * 1. Dedupes backend citations by `chunk_id`.
 * 2. Groups by `source_url` — one tool-ui Citation per unique URL.
 * 3. Skips entries with no `source_url`: tool-ui's schema requires a valid
 *    URL in `href`, and we don't have a sensible fallback target.
 * 4. Concatenates chunk text into a single snippet per source (capped).
 * 5. Coerces the backend's `YYYY-MM-DD` publish_date into a valid ISO
 *    datetime since tool-ui's Zod schema uses `.datetime()`.
 */
const SNIPPET_CHAR_CAP = 400;

export function toToolUiCitations(
  backendCitations: Citation[],
): SerializableCitation[] {
  // Step 1: dedupe by chunk_id.
  const uniqueByChunk = new Map<string, Citation>();
  for (const c of backendCitations) {
    if (!uniqueByChunk.has(c.chunk_id)) {
      uniqueByChunk.set(c.chunk_id, c);
    }
  }

  // Step 2 + 3: group by source_url, skip missing URLs.
  const bySource = new Map<string, Citation[]>();
  for (const c of uniqueByChunk.values()) {
    if (!c.source_url) continue;
    const list = bySource.get(c.source_url) ?? [];
    list.push(c);
    bySource.set(c.source_url, list);
  }

  const result: SerializableCitation[] = [];
  for (const [href, group] of bySource) {
    const first = group[0];
    const combinedSnippet =
      group
        .map((c) => c.text)
        .join("\n\n")
        .slice(0, SNIPPET_CHAR_CAP) || undefined;
    const domain = deriveDomain(href);
    const publishedAt = toIsoDatetime(first.metadata.publish_date);
    result.push({
      id: first.chunk_id,
      href,
      title: first.title || "Untitled source",
      ...(combinedSnippet ? { snippet: combinedSnippet } : {}),
      ...(domain ? { domain } : {}),
      ...(publishedAt ? { publishedAt } : {}),
      type: "article",
    });
  }
  return result;
}

const deriveDomain = (href: string): string | undefined => {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
};

// tool-ui expects ISO 8601 datetime (Zod `.datetime()`). Backend may emit
// `YYYY-MM-DD`, full ISO, null, or unparseable strings. Expand date-only
// values to midnight UTC; drop anything we can't parse.
const toIsoDatetime = (
  value: string | null | undefined,
): string | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
};
