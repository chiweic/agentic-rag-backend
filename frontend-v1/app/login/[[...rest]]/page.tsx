"use client";

import { SignIn } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { createDevToken, isDevAuthEnabled } from "@/lib/auth-client";
import { useAuthStore } from "@/lib/auth-store";
import { isClerkEnabled } from "@/lib/clerk";

function LegacyLoginPage({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const token = useAuthStore((state) => state.token);
  const signInWithToken = useAuthStore((state) => state.signInWithToken);
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [devSub, setDevSub] = useState("playwright-user");
  const [devEmail, setDevEmail] = useState("playwright@example.com");
  const [devName, setDevName] = useState("Playwright User");

  useEffect(() => {
    if (token) {
      router.replace(returnTo);
    }
  }, [returnTo, router, token]);

  const handleDevLogin = async () => {
    try {
      setStatus("working");
      setError(null);
      const devToken = await createDevToken({
        sub: devSub,
        email: devEmail,
        name: devName,
      });
      signInWithToken(devToken);
      router.replace(returnTo);
    } catch (cause) {
      setStatus("error");
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to sign in with dev token",
      );
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-12">
      <div className="rounded-2xl border bg-background p-8 shadow-sm">
        <div className="text-sm font-medium text-muted-foreground">Phase 4</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Clerk is disabled in this environment. The dev-token login below
          exists only for local testing and Playwright.
        </p>

        <div className="mt-6 space-y-3">
          {isDevAuthEnabled ? (
            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="text-sm font-medium">Dev auth</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Uses `POST /auth/dev-token` when backend `AUTH_DEV_MODE` is
                enabled.
              </p>
              <div className="mt-3 space-y-2">
                <input
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none"
                  value={devSub}
                  onChange={(event) => setDevSub(event.target.value)}
                  placeholder="sub"
                />
                <input
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none"
                  value={devEmail}
                  onChange={(event) => setDevEmail(event.target.value)}
                  placeholder="email"
                />
                <input
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none"
                  value={devName}
                  onChange={(event) => setDevName(event.target.value)}
                  placeholder="name"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={handleDevLogin}
                  disabled={status === "working"}
                  data-testid="dev-auth-sign-in-button"
                >
                  Sign in with dev token
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              Dev auth is disabled in this environment. Enable
              `NEXT_PUBLIC_ENABLE_DEV_AUTH=true` and backend
              `AUTH_DEV_MODE=True` for local test login.
            </div>
          )}
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <div className="mt-6 text-sm text-muted-foreground">
          <Link className="underline" href={returnTo}>
            Back to app
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function LoginCatchAllPage() {
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo") ?? "/";

  if (!isClerkEnabled) {
    return <LegacyLoginPage returnTo={returnTo} />;
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-12">
      <div className="rounded-2xl border bg-background p-8 shadow-sm">
        <div className="text-sm font-medium text-muted-foreground">Phase 5</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Clerk now owns the production sign-in and registration flow.
        </p>
        <div className="mt-6">
          <SignIn
            routing="path"
            path="/login"
            forceRedirectUrl={returnTo}
            signUpUrl={`/register?returnTo=${encodeURIComponent(returnTo)}`}
          />
        </div>
      </div>
    </main>
  );
}
