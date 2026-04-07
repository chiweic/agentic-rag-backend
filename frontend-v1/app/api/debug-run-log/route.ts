import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const isEnabled = process.env.NODE_ENV !== "production";
const logDir = path.join(process.cwd(), ".debug");
const logFile = path.join(logDir, "run-debug.ndjson");

export async function POST(request: Request) {
  if (!isEnabled) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    await mkdir(logDir, { recursive: true });
    await appendFile(logFile, `${JSON.stringify(body)}\n`, "utf8");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Failed to append debug log",
      },
      { status: 500 },
    );
  }
}
