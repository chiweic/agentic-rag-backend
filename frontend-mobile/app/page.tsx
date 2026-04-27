import LogtoClient from "@logto/next/edge";
import { headers } from "next/headers";
import { NextRequest } from "next/server";
import { Chat } from "@/components/chat/Chat";
import { logtoConfig } from "@/lib/logto";

export const runtime = "edge";

export default async function Home() {
  const client = new LogtoClient(logtoConfig);
  const h = await headers();
  const cookie = h.get("cookie") ?? "";
  const request = new NextRequest("http://localhost", {
    headers: { cookie },
  });
  const context = await client.getLogtoContext(request, { fetchUserInfo: true });

  const name =
    context.userInfo?.name ??
    context.userInfo?.username ??
    context.userInfo?.email ??
    context.claims?.sub ??
    "anonymous";

  return <Chat userName={name} />;
}
