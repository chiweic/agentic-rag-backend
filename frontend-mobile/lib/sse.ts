export type SseEvent = { event: string; data: string };

function parseRawEvent(raw: string): SseEvent | null {
  const lines = raw.split("\n");
  let event = "";
  const data: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!event || data.length === 0) return null;
  return { event, data: data.join("\n") };
}

export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    const raw = done ? [buffer] : buffer.split("\n\n");
    buffer = done ? "" : (raw.pop() ?? "");
    for (const ev of raw) {
      const parsed = parseRawEvent(ev);
      if (parsed && parsed.data !== "null") yield parsed;
    }
    if (done) return;
  }
}
