import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock auth-store to avoid zustand/persist issues in Node
vi.mock("@/lib/auth-store", () => {
  let storedToken: string | null = null;
  return {
    getAuthToken: async () => storedToken,
    invalidateAuthSession: vi.fn(),
    // Test helper to set token
    __setToken: (token: string | null) => {
      storedToken = token;
    },
  };
});

const authMock = (await import(
  "@/lib/auth-store"
)) as typeof import("@/lib/auth-store") & {
  __setToken: (token: string | null) => void;
};

const {
  BackendAuthError,
  BackendRequestError,
  createBackendThread,
  listBackendThreads,
  renameBackendThread,
  deleteBackendThread,
  getBackendThreadState,
} = await import("@/lib/backend-threads");

beforeEach(() => {
  vi.restoreAllMocks();
  authMock.__setToken(null);
});

function mockFetch(response: {
  ok: boolean;
  status?: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}) {
  const mock = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: response.json ?? (() => Promise.resolve({})),
    text: response.text ?? (() => Promise.resolve("")),
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("createBackendThread", () => {
  it("sends POST /threads with auth header", async () => {
    authMock.__setToken("test-token");
    const fetchMock = mockFetch({
      ok: true,
      json: () =>
        Promise.resolve({ thread_id: "t-123", title: null, created_at: 1000 }),
    });

    const result = await createBackendThread();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/threads");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-token");
    expect(result.thread_id).toBe("t-123");
  });

  it("omits Authorization header when no token", async () => {
    authMock.__setToken(null);
    const fetchMock = mockFetch({
      ok: true,
      json: () => Promise.resolve({ thread_id: "t-456" }),
    });

    await createBackendThread();

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers.Authorization).toBeUndefined();
  });
});

describe("listBackendThreads", () => {
  it("sends GET /threads", async () => {
    authMock.__setToken("token");
    const fetchMock = mockFetch({
      ok: true,
      json: () => Promise.resolve([{ thread_id: "t-1" }, { thread_id: "t-2" }]),
    });

    const result = await listBackendThreads();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/threads");
    expect(result).toHaveLength(2);
  });
});

describe("renameBackendThread", () => {
  it("sends PATCH with title", async () => {
    authMock.__setToken("token");
    const fetchMock = mockFetch({ ok: true, json: () => Promise.resolve({}) });

    await renameBackendThread("t-1", "New Title");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/threads/t-1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ title: "New Title" });
  });
});

describe("deleteBackendThread", () => {
  it("sends DELETE request", async () => {
    authMock.__setToken("token");
    const fetchMock = mockFetch({ ok: true, json: () => Promise.resolve({}) });

    await deleteBackendThread("t-1");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/threads/t-1");
    expect(init.method).toBe("DELETE");
  });
});

describe("getBackendThreadState", () => {
  it("sends GET /threads/{id}/state", async () => {
    authMock.__setToken("token");
    const fetchMock = mockFetch({
      ok: true,
      json: () =>
        Promise.resolve({
          thread_id: "t-1",
          messages: [
            { id: "m1", role: "user", content: [{ type: "text", text: "hi" }] },
          ],
        }),
    });

    const result = await getBackendThreadState("t-1");

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/threads/t-1/state");
    expect(result.messages).toHaveLength(1);
  });
});

describe("error handling", () => {
  it("throws BackendAuthError on 401", async () => {
    authMock.__setToken("expired-token");
    mockFetch({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Token expired"),
    });

    await expect(listBackendThreads()).rejects.toThrow(BackendAuthError);
  });

  it("calls invalidateAuthSession on 401", async () => {
    authMock.__setToken("expired-token");
    mockFetch({
      ok: false,
      status: 401,
      text: () => Promise.resolve(""),
    });

    try {
      await listBackendThreads();
    } catch {
      // expected
    }

    expect(authMock.invalidateAuthSession).toHaveBeenCalled();
  });

  it("throws BackendRequestError on non-401 errors", async () => {
    authMock.__setToken("token");
    mockFetch({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });

    await expect(createBackendThread()).rejects.toThrow(BackendRequestError);
  });

  it("includes status code in BackendRequestError", async () => {
    authMock.__setToken("token");
    mockFetch({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not found"),
    });

    try {
      await createBackendThread();
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BackendRequestError);
      expect((err as InstanceType<typeof BackendRequestError>).status).toBe(
        404,
      );
    }
  });
});
