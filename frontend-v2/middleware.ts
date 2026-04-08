import { type NextRequest, NextResponse } from "next/server";

const publicPaths = ["/api", "/callback"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public routes
  if (publicPaths.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Check for Logto session cookie (name = logto_<appId>)
  const appId = process.env["LOGTO_APP_ID"] ?? "";
  const sessionCookie = request.cookies.get(`logto_${appId}`);

  if (!sessionCookie) {
    // Redirect to Logto sign-in
    const signInUrl = new URL("/api/auth/sign-in", request.url);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
  ],
};
