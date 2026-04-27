async function fetchAccessToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/token", { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    return data.accessToken ?? null;
  } catch {
    return null;
  }
}

let cached: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string | null> {
  const now = Date.now();
  if (cached && cached.expiresAt > now + 5_000) return cached.token;
  const token = await fetchAccessToken();
  if (token) cached = { token, expiresAt: now + 60_000 };
  return token;
}

export function clearTokenCache() {
  cached = null;
}
