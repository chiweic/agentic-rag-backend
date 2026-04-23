export type EventRecord = {
  chunk_id: string;
  title: string;
  text: string;
  source_url: string | null;
  score: number | null;
  metadata: {
    record_id?: string;
    source_type?: string;
    chunk_index?: number;
    publish_date?: string | null;
    book_title?: string;
    chapter_title?: string;
    category?: string;
    attribution?: string;
  } & Record<string, unknown>;
};

export type RecommendationStatus =
  | "ok"
  | "no_activity"
  | "summary_failed"
  | "no_matches";

export type RecommendationResponse = {
  status: RecommendationStatus;
  profile: string;
  events: EventRecord[];
};

let tokenResolver: (() => Promise<string | null>) | null = null;

export function setRecommendationsTokenResolver(
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

export type FetchRecommendationsOptions = {
  limit?: number;
  /**
   * rag_bot corpora to pull recommendations from. When omitted the
   * backend defaults to `["events"]` (features_v2 §4a behaviour). Pass
   * `["audio", "video_ddmtv01", "video_ddmtv02"]` for the 聖嚴師父身影
   * tab (features_v3 §1).
   */
  sources?: readonly string[];
};

/**
 * Fetch event recommendations for the current user. Caller owns the
 * loading/error UI — this just throws on non-2xx so the page can
 * distinguish network/auth errors from the backend's typed status
 * codes (no_activity / summary_failed / no_matches all come back as
 * a 200 with `status` set).
 */
export async function fetchRecommendations(
  opts: FetchRecommendationsOptions = {},
): Promise<RecommendationResponse> {
  const { limit = 6, sources } = opts;
  const url = new URL(`${getApiUrl()}/recommendations`);
  url.searchParams.set("limit", String(limit));
  if (sources && sources.length > 0) {
    url.searchParams.set("sources", sources.join(","));
  }
  const res = await fetch(url.toString(), { headers: await authHeaders() });
  if (!res.ok) {
    throw new Error(`Failed to fetch recommendations: ${res.status}`);
  }
  return (await res.json()) as RecommendationResponse;
}
