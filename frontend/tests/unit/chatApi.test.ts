import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createThread,
  getThreadState,
  sendMessage,
  setTokenResolver,
} from "@/lib/chatApi";
import * as followupSuggestions from "@/lib/followupSuggestions";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
vi.stubGlobal("window", { location: { href: "http://localhost:3000/" } });

const encodeSse = (chunks: string[]) => {
  const encoder = new TextEncoder();
  let index = 0;

  return {
    getReader: () => ({
      read: vi.fn().mockImplementation(async () => {
        if (index >= chunks.length) {
          return { done: true, value: undefined };
        }
        return {
          done: false,
          value: encoder.encode(chunks[index++]),
        };
      }),
    }),
  };
};

beforeEach(() => {
  mockFetch.mockReset();
  setTokenResolver(async () => "test-token");
  vi.restoreAllMocks();
});

describe("chatApi", () => {
  it("loads text and citations blocks from thread state", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        messages: [
          {
            id: "a1",
            role: "assistant",
            content: [
              { type: "text", text: "Grounded answer." },
              {
                type: "citations",
                citations: [
                  {
                    chunk_id: "chunk-1",
                    text: "Quoted source text",
                    title: "Source A",
                    source_url: "https://example.com/a",
                    score: 0.91,
                    metadata: { source_type: "faguquanji" },
                  },
                ],
              },
            ],
          },
        ],
      }),
    });

    const result = await getThreadState("thread-1");

    expect(result.messages).toEqual([
      {
        id: "a1",
        type: "ai",
        content: [{ type: "text", text: "Grounded answer." }],
        additional_kwargs: {
          metadata: {
            citations: [
              {
                chunk_id: "chunk-1",
                text: "Quoted source text",
                title: "Source A",
                source_url: "https://example.com/a",
                score: 0.91,
                metadata: { source_type: "faguquanji" },
              },
            ],
          },
        },
      },
    ]);
  });

  it("keeps partial text chunks separate from final values citations", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: encodeSse([
        'event: messages/partial\ndata: {"id":"a1","role":"assistant","content":[{"type":"text","text":"Hello"}]}\n',
        "\n",
        'event: values\ndata: {"messages":[{"id":"a1","role":"assistant","content":[{"type":"text","text":"Hello"},{"type":"citations","citations":[{"chunk_id":"chunk-1","text":"Quoted source text","title":"Source A","source_url":"https://example.com/a","score":0.91,"metadata":{"source_type":"faguquanji"}}]}]}]}\n',
        "\n",
      ]),
    });

    const events = [];
    for await (const event of sendMessage({
      threadId: "thread-1",
      messages: [{ id: "u1", type: "human", content: "Hi" }],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        event: "messages/partial",
        data: [
          { id: "a1", type: "ai", content: [{ type: "text", text: "Hello" }] },
        ],
      },
      {
        event: "values",
        data: {
          messages: [
            {
              id: "a1",
              type: "ai",
              content: [{ type: "text", text: "Hello" }],
              additional_kwargs: {
                metadata: {
                  citations: [
                    {
                      chunk_id: "chunk-1",
                      text: "Quoted source text",
                      title: "Source A",
                      source_url: "https://example.com/a",
                      score: 0.91,
                      metadata: { source_type: "faguquanji" },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    ]);
  });

  it("parses values events when SSE frames are split across chunks", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: encodeSse([
        'event: messages/partial\ndata: {"id":"a1","role":"assistant","content":[{"type":"text","text":"Hel',
        'lo"}]}\n\n',
        'event: values\ndata: {"messages":[{"id":"a1","role":"assistant","content":[{"type":"text","text":"Hello"},{"type":"citations","citations":[{"chunk_id":"chunk-1","text":"Quoted source text","title":"Source A","source_url":"https://example.com/a","score":0.91,"metadata":{"source_type":"faguquanji"}}]}]}]}\n\n',
      ]),
    });

    const events = [];
    for await (const event of sendMessage({
      threadId: "thread-1",
      messages: [{ id: "u1", type: "human", content: "Hi" }],
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toEqual({
      event: "values",
      data: {
        messages: [
          {
            id: "a1",
            type: "ai",
            content: [{ type: "text", text: "Hello" }],
            additional_kwargs: {
              metadata: {
                citations: [
                  {
                    chunk_id: "chunk-1",
                    text: "Quoted source text",
                    title: "Source A",
                    source_url: "https://example.com/a",
                    score: 0.91,
                    metadata: { source_type: "faguquanji" },
                  },
                ],
              },
            },
          },
        ],
      },
    });
  });

  it("stores follow-up suggestions from the final suggestions event", async () => {
    const setFollowupSuggestionsSpy = vi.spyOn(
      followupSuggestions,
      "setFollowupSuggestions",
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: encodeSse([
        'event: suggestions/final\ndata: {"suggestions":[{"id":"s1","text":"What are the main penalties?"},{"id":"s2","text":"Can you summarize the exceptions?"}]}\n\n',
      ]),
    });

    const events = [];
    for await (const event of sendMessage({
      threadId: "thread-1",
      messages: [{ id: "u1", type: "human", content: "Hi" }],
    })) {
      events.push(event);
    }

    expect(setFollowupSuggestionsSpy).toHaveBeenCalledWith("thread-1", [
      { id: "s1", text: "What are the main penalties?" },
      { id: "s2", text: "Can you summarize the exceptions?" },
    ]);
    expect(events).toEqual([]);
  });

  it("sends auth headers on create", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ thread_id: "thread-1" }),
    });

    await createThread();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/threads"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-token",
        }),
      }),
    );
  });
});
