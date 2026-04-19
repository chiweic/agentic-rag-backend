import LogtoClient from "@logto/next/edge";
import { type NextRequest, NextResponse } from "next/server";
import { logtoConfig } from "@/lib/logto";

export async function GET(request: NextRequest) {
  try {
    const client = new LogtoClient(logtoConfig);
    const resource = logtoConfig.resources?.[0];
    const context = await client.getLogtoContext(request, {
      resource,
      getAccessToken: true,
    });

    if (!context.isAuthenticated) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    return NextResponse.json({ accessToken: context.accessToken });
  } catch {
    return NextResponse.json({ error: "Failed to get token" }, { status: 401 });
  }
}
