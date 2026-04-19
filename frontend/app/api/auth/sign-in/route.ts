import LogtoClient from "@logto/next/edge";
import { logtoConfig } from "@/lib/logto";

export async function GET(request: Request) {
  const client = new LogtoClient(logtoConfig);
  return client.handleSignIn()(request);
}
