"use client";

import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { isClerkEnabled } from "@/lib/clerk";

export default function RegisterCatchAllPage() {
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo") ?? "/";

  if (!isClerkEnabled) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-12">
        <div className="rounded-2xl border bg-background p-8 shadow-sm">
          <div className="text-sm font-medium text-muted-foreground">
            Phase 5
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Register
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Clerk is not configured in this environment yet.
          </p>
          <div className="mt-6 text-sm text-muted-foreground">
            <Link className="underline" href="/login">
              Back to sign in
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-12">
      <div className="rounded-2xl border bg-background p-8 shadow-sm">
        <div className="text-sm font-medium text-muted-foreground">Phase 5</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Create account
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Clerk now owns the production registration flow.
        </p>
        <div className="mt-6">
          <SignUp
            routing="path"
            path="/register"
            forceRedirectUrl={returnTo}
            signInUrl={`/login?returnTo=${encodeURIComponent(returnTo)}`}
          />
        </div>
      </div>
    </main>
  );
}
