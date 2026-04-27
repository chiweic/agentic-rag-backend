import { NextResponse } from "next/server";
import { logtoConfig } from "@/lib/logto";

export async function GET() {
  const postLogoutRedirectUri = logtoConfig.baseUrl;
  const endSessionUrl = new URL(`/oidc/session/end`, logtoConfig.endpoint);
  endSessionUrl.searchParams.set(
    "post_logout_redirect_uri",
    postLogoutRedirectUri,
  );
  endSessionUrl.searchParams.set("client_id", logtoConfig.appId);

  // Clear the Logto session cookie
  const response = NextResponse.redirect(endSessionUrl.toString());
  response.cookies.delete(`logto_${logtoConfig.appId}`);
  return response;
}
