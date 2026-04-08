import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock window.location for getBaseUrl fallback
vi.stubGlobal("window", { location: { href: "http://localhost:3000/" } });

import { setTokenResolver, threadListAdapter } from "@/lib/threadListAdapter";

beforeEach(() => {
  mockFetch.mockReset();
  setTokenResolver(async () => "test-token");
});

describe("threadListAdapter", () => {
  describe("list", () => {
    it("fetches threads and maps to RemoteThreadMetadata", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { thread_id: "t1", title: "Hello", is_archived: false },
          { thread_id: "t2", title: null, is_archived: true },
        ],
      });

      const result = await threadListAdapter.list();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/threads"),
        expect.objectContaining({
          headers: expect.objectContaining({
            authorization: "Bearer test-token",
          }),
        }),
      );
      expect(result.threads).toEqual([
        {
          remoteId: "t1",
          externalId: "t1",
          title: "Hello",
          status: "regular",
        },
        {
          remoteId: "t2",
          externalId: "t2",
          title: undefined,
          status: "archived",
        },
      ]);
    });

    it("throws on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
      await expect(threadListAdapter.list()).rejects.toThrow("401");
    });
  });

  describe("initialize", () => {
    it("creates a thread and returns remoteId + externalId", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ thread_id: "new-thread-id" }),
      });

      const result = await threadListAdapter.initialize("local-id");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/threads"),
        expect.objectContaining({ method: "POST" }),
      );
      expect(result).toEqual({
        remoteId: "new-thread-id",
        externalId: "new-thread-id",
      });
    });
  });

  describe("rename", () => {
    it("patches thread title", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await threadListAdapter.rename("t1", "New Title");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/threads/t1"),
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ title: "New Title" }),
        }),
      );
    });
  });

  describe("archive", () => {
    it("patches is_archived to true", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await threadListAdapter.archive("t1");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/threads/t1"),
        expect.objectContaining({
          body: JSON.stringify({ is_archived: true }),
        }),
      );
    });
  });

  describe("delete", () => {
    it("sends DELETE request", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await threadListAdapter.delete("t1");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/threads/t1"),
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });

  describe("fetch", () => {
    it("fetches single thread metadata", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          thread_id: "t1",
          title: "My Thread",
          is_archived: false,
        }),
      });

      const result = await threadListAdapter.fetch("t1");

      expect(result).toEqual({
        remoteId: "t1",
        externalId: "t1",
        title: "My Thread",
        status: "regular",
      });
    });
  });

  describe("auth header", () => {
    it("sends no auth header when token resolver returns null", async () => {
      setTokenResolver(async () => null);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await threadListAdapter.list();

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers).not.toHaveProperty("authorization");
    });
  });
});
