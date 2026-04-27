import type { Citation } from "./api";

export type Pill = {
  id: string;
  href: string;
  label: string;
  domain?: string;
};

/**
 * Backend emits one citation per retrieved chunk. The mobile pills want one
 * entry per *source URL* (matches the desktop card adapter's grouping). Pill
 * label prefers, in order:
 *   metadata.unit_name (audio corpus — title is just a filename)
 *   metadata.chapter_title
 *   metadata.book_title
 *   citation.title
 *   URL hostname (last-resort)
 * Citations without a source_url are skipped — there's nowhere to tap to.
 */
export function toPills(citations: Citation[]): Pill[] {
  const uniqueByChunk = new Map<string, Citation>();
  for (const c of citations) {
    if (!uniqueByChunk.has(c.chunk_id)) uniqueByChunk.set(c.chunk_id, c);
  }

  const bySource = new Map<string, Citation>();
  for (const c of uniqueByChunk.values()) {
    if (!c.source_url) continue;
    if (!bySource.has(c.source_url)) bySource.set(c.source_url, c);
  }

  const result: Pill[] = [];
  for (const [href, c] of bySource) {
    const label =
      c.metadata.unit_name ||
      c.metadata.chapter_title ||
      c.metadata.book_title ||
      c.title ||
      deriveDomain(href) ||
      "Source";
    result.push({
      id: c.chunk_id,
      href,
      label,
      ...(deriveDomain(href) ? { domain: deriveDomain(href) } : {}),
    });
  }
  return result;
}

function deriveDomain(href: string): string | undefined {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}
