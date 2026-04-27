export type WhatsNewSuggestion = {
  id: string;
  title: string;
  source: string;
  url: string | null;
  action: string;
  combined_prompt: string;
};

export type WhatsNewStatus = "ok" | "no_news" | "no_feed";

export type WhatsNewResponse = {
  status: WhatsNewStatus;
  profile: string;
  suggestions: WhatsNewSuggestion[];
};

let tokenResolver: (() => Promise<string | null>) | null = null;

export function setWhatsNewTokenResolver(
  resolver: () => Promise<string | null>,
) {
  tokenResolver = resolver;
}

async function fetchAccessTokenFallback(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/token");
    if (!res.ok) return null;
    const data = await res.json();
    return data.accessToken ?? null;
  } catch {
    return null;
  }
}

const getApiUrl = () =>
  process.env["NEXT_PUBLIC_LANGGRAPH_API_URL"] ||
  new URL("/api", window.location.href).href;

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const token = tokenResolver
    ? await tokenResolver()
    : await fetchAccessTokenFallback();
  if (token) headers["authorization"] = `Bearer ${token}`;
  return headers;
}

/**
 * Fetch welcome-card suggestions for the 新鮮事 tab. Each suggestion
 * is a news headline paired with an LLM-generated dharma action
 * question; clicking a card sends `combined_prompt` as a chat turn.
 *
 * Caller owns the loading / error UI — this just throws on non-2xx
 * so the page can distinguish network/auth errors from the typed
 * status codes (no_feed / no_news come back as 200).
 */
export async function fetchWhatsNewSuggestions(
  limit = 6,
): Promise<WhatsNewResponse> {
  const url = new URL(`${getApiUrl()}/whats-new-suggestions`);
  url.searchParams.set("limit", String(limit));
  const res = await fetch(url.toString(), { headers: await authHeaders() });
  if (!res.ok) {
    throw new Error(`Failed to fetch whats-new suggestions: ${res.status}`);
  }
  return (await res.json()) as WhatsNewResponse;
}
