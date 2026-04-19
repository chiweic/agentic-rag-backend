import type { Citation } from "@/lib/chatApi";

export type SourceRecord = {
  record_id: string;
  source_type: string;
  title: string;
  source_url: string | null;
  book_title: string | null;
  chapter_title: string | null;
  attribution: string | null;
  publish_date: string | null;
  chunks: Citation[];
};

let tokenResolver: (() => Promise<string | null>) | null = null;

export function setTokenResolver(resolver: () => Promise<string | null>) {
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

const getAuthHeaders = async (): Promise<Record<string, string>> => {
  const headers: Record<string, string> = {};
  const token = tokenResolver
    ? await tokenResolver()
    : await fetchAccessTokenFallback();
  if (token) {
    headers["authorization"] = `Bearer ${token}`;
  }
  return headers;
};

/**
 * Fetch the full record (all chunks in order) for deep-dive display.
 * Throws on non-2xx; callers should surface an error state.
 */
export async function fetchSourceRecord(
  sourceType: string,
  recordId: string,
): Promise<SourceRecord> {
  const encoded =
    encodeURIComponent(sourceType) + "/" + encodeURIComponent(recordId);
  const res = await fetch(`${getApiUrl()}/sources/${encoded}`, {
    headers: await getAuthHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch source: ${res.status}`);
  }
  return (await res.json()) as SourceRecord;
}
