import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock useChatStore before importing auth-store (it imports chat-store at module level)
vi.mock("@/lib/chat-store", () => ({
  useChatStore: {
    getState: () => ({ resetForAuthBoundary: vi.fn() }),
    setState: vi.fn(),
    getInitialState: vi.fn(),
  },
}));

// Must import after mocking
const { useAuthStore, getStoredAuthToken, getAuthToken, setAuthTokenResolver } =
  await import("@/lib/auth-store");

// Helper: create a minimal JWT with the given payload
function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  // Use standard base64 (atob/btoa work in Node 18+)
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fake-signature`;
}

beforeEach(() => {
  useAuthStore.setState({
    token: null,
    profile: null,
    hasHydrated: false,
    authMessage: null,
  });
  setAuthTokenResolver(null);
});

describe("signInWithToken", () => {
  it("decodes JWT and sets profile with dev provider", () => {
    const token = makeJwt({
      sub: "user-1",
      iss: "https://dev.local",
      email: "test@example.com",
      name: "Test User",
      exp: 9999999999,
    });

    useAuthStore.getState().signInWithToken(token);
    const state = useAuthStore.getState();

    expect(state.token).toBe(token);
    expect(state.profile).not.toBeNull();
    expect(state.profile?.sub).toBe("user-1");
    expect(state.profile?.provider).toBe("dev");
    expect(state.profile?.userId).toBe("dev:user-1");
    expect(state.profile?.email).toBe("test@example.com");
    expect(state.profile?.name).toBe("Test User");
  });

  it("detects google provider from issuer", () => {
    const token = makeJwt({
      sub: "google-user",
      iss: "https://accounts.google.com",
      exp: 9999999999,
    });

    useAuthStore.getState().signInWithToken(token);
    expect(useAuthStore.getState().profile?.provider).toBe("google");
    expect(useAuthStore.getState().profile?.userId).toBe("google:google-user");
  });

  it("detects clerk provider from issuer", () => {
    const token = makeJwt({
      sub: "clerk-user",
      iss: "https://my-app.clerk.accounts.dev",
      exp: 9999999999,
    });

    useAuthStore.getState().signInWithToken(token);
    expect(useAuthStore.getState().profile?.provider).toBe("clerk");
    expect(useAuthStore.getState().profile?.userId).toBe("clerk:clerk-user");
  });

  it("clears authMessage on sign in", () => {
    useAuthStore.setState({ authMessage: "Previous error" });
    const token = makeJwt({ sub: "u1", iss: "https://dev.local", exp: 9999 });

    useAuthStore.getState().signInWithToken(token);
    expect(useAuthStore.getState().authMessage).toBeNull();
  });
});

describe("signOut", () => {
  it("clears token and profile", () => {
    const token = makeJwt({ sub: "u1", iss: "https://dev.local", exp: 9999 });
    useAuthStore.getState().signInWithToken(token);

    useAuthStore.getState().signOut();

    const state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.profile).toBeNull();
  });

  it("sets authMessage when provided", () => {
    useAuthStore.getState().signOut("Session expired");
    expect(useAuthStore.getState().authMessage).toBe("Session expired");
  });

  it("defaults authMessage to null", () => {
    useAuthStore.getState().signOut();
    expect(useAuthStore.getState().authMessage).toBeNull();
  });
});

describe("syncExternalAuth", () => {
  it("syncs external profile to store", () => {
    const token = makeJwt({
      sub: "ext-1",
      iss: "https://dev.local",
      exp: 9999,
    });
    useAuthStore.getState().syncExternalAuth({
      token,
      profile: {
        sub: "ext-1",
        provider: "clerk",
        email: "ext@example.com",
        name: "External",
        picture: null,
        exp: 9999,
      },
    });

    const state = useAuthStore.getState();
    expect(state.token).toBe(token);
    expect(state.profile?.userId).toBe("clerk:ext-1");
    expect(state.profile?.email).toBe("ext@example.com");
  });

  it("clears state when token is null", () => {
    const token = makeJwt({ sub: "u1", iss: "https://dev.local", exp: 9999 });
    useAuthStore.getState().signInWithToken(token);

    useAuthStore.getState().syncExternalAuth({ token: null, profile: null });

    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().profile).toBeNull();
  });
});

describe("getStoredAuthToken", () => {
  it("returns stored token", () => {
    const token = makeJwt({ sub: "u1", iss: "https://dev.local", exp: 9999 });
    useAuthStore.getState().signInWithToken(token);

    expect(getStoredAuthToken()).toBe(token);
  });

  it("returns null when not signed in", () => {
    expect(getStoredAuthToken()).toBeNull();
  });
});

describe("getAuthToken", () => {
  it("falls back to stored token when no resolver", async () => {
    const token = makeJwt({ sub: "u1", iss: "https://dev.local", exp: 9999 });
    useAuthStore.getState().signInWithToken(token);

    const result = await getAuthToken();
    expect(result).toBe(token);
  });

  it("uses custom resolver when set", async () => {
    setAuthTokenResolver(async () => "custom-token");

    const result = await getAuthToken();
    expect(result).toBe("custom-token");
  });
});

describe("clearAuthMessage", () => {
  it("clears the auth message", () => {
    useAuthStore.setState({ authMessage: "Error occurred" });
    useAuthStore.getState().clearAuthMessage();
    expect(useAuthStore.getState().authMessage).toBeNull();
  });
});
