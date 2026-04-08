import LogtoClient from "@logto/next/edge";
import type { NextRequest } from "next/server";
import { logtoConfig } from "@/lib/logto";

export async function GET(request: NextRequest) {
  const client = new LogtoClient(logtoConfig);
  return client.handleSignInCallback("/")(request);
}
