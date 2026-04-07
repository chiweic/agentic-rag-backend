"use client";

const BACKEND_BASE_URL =
  process.env.NEXT_PUBLIC_BACKEND_BASE_URL?.replace(/\/$/, "") ??
  "http://localhost:8081";

export const isDevAuthEnabled =
  process.env.NEXT_PUBLIC_ENABLE_DEV_AUTH === "true";

export const createDevToken = async ({
  sub,
  email,
  name,
  ttlSeconds = 3600,
}: {
  sub: string;
  email?: string;
  name?: string;
  ttlSeconds?: number;
}) => {
  const response = await fetch(`${BACKEND_BASE_URL}/auth/dev-token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sub,
      email,
      name,
      ttl_seconds: ttlSeconds,
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const payload = (await response.json()) as { access_token: string };
  return payload.access_token;
};
