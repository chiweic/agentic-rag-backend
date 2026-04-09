import { createOpenAI } from "@ai-sdk/openai";
import { convertToModelMessages, streamText } from "ai";

const BACKEND_BASE_URL =
  process.env.EXPO_PUBLIC_BACKEND_BASE_URL ?? "http://localhost:7081";

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return new Response("Missing authorization header", { status: 401 });
  }

  const body = await req.json();
  const { messages } = body ?? {};

  if (!messages) {
    return new Response("Missing messages", { status: 400 });
  }

  const token = authHeader.replace(/^Bearer\s+/i, "");

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
