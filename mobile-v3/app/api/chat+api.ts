import { createOpenAI } from "@ai-sdk/openai";
import { convertToModelMessages, streamText } from "ai";

const BACKEND_BASE_URL =
  process.env.EXPO_PUBLIC_BACKEND_BASE_URL ?? "http://localhost:7081";
const DEV_TOKEN_URL = `${BACKEND_BASE_URL}/auth/dev-token`;

// Cache dev token in-memory (server-side route, persists across requests)
let cachedToken: string | null = null;
let tokenExpiry = 0;

async function getDevToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry - 60_000) {
    return cachedToken;
  }

  const res = await fetch(DEV_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sub: "dev-mobile-user",
      email: "dev@mobile.local",
      name: "Dev Mobile User",
      ttl_seconds: 3600,
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to get dev token: ${res.status}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + data.expires_in * 1000;
  return cachedToken!;
}

export async function POST(req: Request) {
  const body = await req.json();
  const { messages } = body ?? {};

  if (!messages) {
    return new Response("Missing messages", { status: 400 });
  }

  const token = await getDevToken();

  const backend = createOpenAI({
    baseURL: `${BACKEND_BASE_URL}/v1`,
    apiKey: token,
    compatibility: "compatible",
  });

  const result = streamText({
    model: backend.chat("agentic-rag"),
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
