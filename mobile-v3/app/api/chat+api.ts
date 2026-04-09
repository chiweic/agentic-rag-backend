import { openai } from "@ai-sdk/openai";
import { convertToModelMessages, streamText } from "ai";

export async function POST(req: Request) {
  const body = await req.json();
  const { messages } = body ?? {};

  if (!messages) {
    return new Response("Missing messages", { status: 400 });
  }

  const result = streamText({
    model: openai("gpt-4o-mini"),
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
