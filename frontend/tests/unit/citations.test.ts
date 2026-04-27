import { describe, expect, it } from "vitest";
import type { Citation } from "@/lib/chatApi";
import { toToolUiCitations } from "@/lib/citations-adapter";

const cite = (overrides: Partial<Citation> = {}): Citation => ({
  chunk_id: "chunk-1",
  text: "source text",
  title: "A Source",
  source_url: "https://example.com/page",
  score: 0.9,
  metadata: { source_type: "faguquanji" },
  ...overrides,
});

describe("toToolUiCitations", () => {
  it("dedupes backend citations by chunk_id", () => {
    const out = toToolUiCitations([
      cite({ chunk_id: "c1", source_url: "https://a/1" }),
      cite({ chunk_id: "c1", source_url: "https://a/1" }),
      cite({ chunk_id: "c2", source_url: "https://a/2" }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.href)).toEqual(["https://a/1", "https://a/2"]);
  });

  it("groups chunks by source_url into a single entry", () => {
    const out = toToolUiCitations([
      cite({
        chunk_id: "c1",
        text: "first chunk",
        source_url: "https://doc.a/1",
        title: "Doc A",
      }),
      cite({
        chunk_id: "c2",
        text: "second chunk",
        source_url: "https://doc.a/1",
        title: "Doc A",
      }),
      cite({ chunk_id: "c3", source_url: "https://doc.b/1", title: "Doc B" }),
    ]);
    expect(out).toHaveLength(2);
    const [a, b] = out;
    expect(a.title).toBe("Doc A");
    expect(a.snippet).toContain("first chunk");
    expect(a.snippet).toContain("second chunk");
    expect(b.title).toBe("Doc B");
  });

  it("skips citations with no source_url", () => {
    const out = toToolUiCitations([
      cite({ chunk_id: "c1", source_url: null }),
      cite({ chunk_id: "c2", source_url: "https://ok/1" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].href).toBe("https://ok/1");
  });

  it("derives domain from source_url, stripping www.", () => {
    const [out] = toToolUiCitations([
      cite({ source_url: "https://www.ddm.org.tw/path?x=1" }),
    ]);
    expect(out.domain).toBe("ddm.org.tw");
  });

  it("expands YYYY-MM-DD publish_date to ISO datetime", () => {
    const [out] = toToolUiCitations([
      cite({
        source_url: "https://ok/1",
        metadata: { source_type: "qa", publish_date: "2020-03-02" },
      }),
    ]);
    // tool-ui's Zod schema requires .datetime() — full ISO 8601.
    expect(out.publishedAt).toMatch(/^2020-03-02T\d{2}:\d{2}:\d{2}/);
  });

  it("omits publishedAt when publish_date is missing or unparseable", () => {
    const [missing] = toToolUiCitations([
      cite({
        chunk_id: "c1",
        source_url: "https://ok/1",
        metadata: { source_type: "faguquanji" },
      }),
    ]);
    expect(missing.publishedAt).toBeUndefined();

    const [bad] = toToolUiCitations([
      cite({
        chunk_id: "c2",
        source_url: "https://ok/2",
        metadata: { source_type: "qa", publish_date: "not-a-date" },
      }),
    ]);
    expect(bad.publishedAt).toBeUndefined();
  });

  it("caps the combined snippet length to avoid huge payloads", () => {
    const longChunks = Array.from({ length: 20 }, (_, i) =>
      cite({
        chunk_id: `c${i}`,
        source_url: "https://same/1",
        text: "x".repeat(100),
      }),
    );
    const [out] = toToolUiCitations(longChunks);
    expect(out.snippet).toBeDefined();
    expect(out.snippet!.length).toBeLessThanOrEqual(400);
  });

  it("defaults title to 'Untitled source' when backend title is empty", () => {
    const [out] = toToolUiCitations([
      cite({ source_url: "https://ok/1", title: "" }),
    ]);
    expect(out.title).toBe("Untitled source");
  });

  it("returns empty array for no citations", () => {
    expect(toToolUiCitations([])).toEqual([]);
  });

  it("returns empty array when all citations lack source_url", () => {
    const out = toToolUiCitations([
      cite({ chunk_id: "c1", source_url: null }),
      cite({ chunk_id: "c2", source_url: null }),
    ]);
    expect(out).toEqual([]);
  });

  it("prefers book_title over URL-derived domain when present", () => {
    const [out] = toToolUiCitations([
      cite({
        source_url: "https://ddc.shengyen.org/html/09-04-025.html",
        metadata: {
          source_type: "faguquanji",
          book_title: "聖嚴法師年譜",
          chapter_title: "第四章",
        },
      }),
    ]);
    expect(out.domain).toBe("聖嚴法師年譜");
  });

  it("falls back to URL domain when book_title is absent", () => {
    const [out] = toToolUiCitations([
      cite({
        source_url: "https://www.example.com/page",
        metadata: { source_type: "qa" },
      }),
    ]);
    expect(out.domain).toBe("example.com");
  });

  it("surfaces attribution as author when present", () => {
    const [out] = toToolUiCitations([
      cite({
        source_url: "https://ok/1",
        metadata: { source_type: "qa", attribution: "Some Author" },
      }),
    ]);
    expect(out.author).toBe("Some Author");
  });

  it("omits author when attribution is missing or empty", () => {
    const [missing] = toToolUiCitations([
      cite({
        source_url: "https://ok/1",
        metadata: { source_type: "faguquanji" },
      }),
    ]);
    expect(missing.author).toBeUndefined();

    const [empty] = toToolUiCitations([
      cite({
        source_url: "https://ok/2",
        metadata: { source_type: "qa", attribution: "" },
      }),
    ]);
    expect(empty.author).toBeUndefined();
  });

  it("stamps every entry with a stable id and type", () => {
    const out = toToolUiCitations([
      cite({ chunk_id: "c1", source_url: "https://a/1" }),
      cite({ chunk_id: "c2", source_url: "https://b/1" }),
    ]);
    expect(out.every((c) => typeof c.id === "string" && c.id.length > 0)).toBe(
      true,
    );
    expect(out.every((c) => c.type === "article")).toBe(true);
  });

  it("carries recordId + sourceType for the Deep Dive action", () => {
    const [out] = toToolUiCitations([
      cite({
        chunk_id: "c1",
        source_url: "https://a/1",
        metadata: {
          source_type: "faguquanji",
          record_id: "REC-99",
          book_title: "Book",
        },
      }),
    ]);
    expect(out.recordId).toBe("REC-99");
    expect(out.sourceType).toBe("faguquanji");
  });

  it("omits recordId when backend doesn't supply it, keeps sourceType", () => {
    const [out] = toToolUiCitations([
      cite({
        chunk_id: "c1",
        source_url: "https://a/1",
        metadata: { source_type: "qa" },
      }),
    ]);
    expect(out.recordId).toBeUndefined();
    expect(out.sourceType).toBe("qa");
  });
});
