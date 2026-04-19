import { describe, expect, it } from "vitest";
import { dedupeAndGroupCitations } from "@/components/assistant-ui/citations";
import type { Citation } from "@/lib/chatApi";

const cite = (overrides: Partial<Citation> = {}): Citation => ({
  chunk_id: "chunk-1",
  text: "source text",
  title: "A Source",
  source_url: "https://example.com/page",
  score: 0.9,
  metadata: { source_type: "faguquanji" },
  ...overrides,
});

describe("dedupeAndGroupCitations", () => {
  it("drops duplicate chunk_ids", () => {
    const groups = dedupeAndGroupCitations([
      cite({ chunk_id: "c1", source_url: "https://a/1" }),
      cite({ chunk_id: "c1", source_url: "https://a/1" }),
      cite({ chunk_id: "c2", source_url: "https://a/2" }),
    ]);
    const totalSnippets = groups.reduce((n, g) => n + g.snippets.length, 0);
    expect(totalSnippets).toBe(2);
  });

  it("groups chunks by source_url", () => {
    const groups = dedupeAndGroupCitations([
      cite({ chunk_id: "c1", source_url: "https://doc.a/1", title: "Doc A" }),
      cite({ chunk_id: "c2", source_url: "https://doc.a/1", title: "Doc A" }),
      cite({ chunk_id: "c3", source_url: "https://doc.b/1", title: "Doc B" }),
    ]);
    expect(groups).toHaveLength(2);
    const [first, second] = groups;
    expect(first.title).toBe("Doc A");
    expect(first.snippets.map((s) => s.chunk_id)).toEqual(["c1", "c2"]);
    expect(second.title).toBe("Doc B");
    expect(second.snippets).toHaveLength(1);
  });

  it("falls back to title then chunk_id when source_url is null", () => {
    const groups = dedupeAndGroupCitations([
      cite({ chunk_id: "c1", source_url: null, title: "Same" }),
      cite({ chunk_id: "c2", source_url: null, title: "Same" }),
      cite({ chunk_id: "c3", source_url: null, title: "Different" }),
    ]);
    expect(groups).toHaveLength(2);
    const titled = groups.find((g) => g.title === "Same");
    expect(titled?.snippets).toHaveLength(2);
  });

  it("derives domain from source_url (stripping www.)", () => {
    const [group] = dedupeAndGroupCitations([
      cite({ source_url: "https://www.ddm.org.tw/path?x=1" }),
    ]);
    expect(group.domain).toBe("ddm.org.tw");
  });

  it("returns null domain for unparsable source_url", () => {
    const [group] = dedupeAndGroupCitations([
      cite({ source_url: "not a url" }),
    ]);
    expect(group.domain).toBeNull();
  });

  it("formats publish_date only when parseable", () => {
    const [valid] = dedupeAndGroupCitations([
      cite({
        chunk_id: "c-valid",
        metadata: { source_type: "qa", publish_date: "2024-05-12" },
      }),
    ]);
    expect(valid.publishDate).toEqual(expect.any(String));
    expect(valid.publishDate?.length).toBeGreaterThan(0);

    const [invalid] = dedupeAndGroupCitations([
      cite({
        chunk_id: "c-invalid",
        metadata: { source_type: "qa", publish_date: "not-a-date" },
      }),
    ]);
    expect(invalid.publishDate).toBeNull();
  });

  it("defaults title to 'Untitled source' when empty", () => {
    const [group] = dedupeAndGroupCitations([cite({ title: "" })]);
    expect(group.title).toBe("Untitled source");
  });

  it("returns empty array for no citations", () => {
    expect(dedupeAndGroupCitations([])).toEqual([]);
  });
});
