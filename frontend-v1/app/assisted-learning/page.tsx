"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type AssistedLearningModule,
  getAssistedLearningModules,
} from "@/lib/assisted-learning";
import { useAuthStore } from "@/lib/auth-store";
import { BackendAuthError } from "@/lib/backend-threads";
import { isClerkEnabled } from "@/lib/clerk";

export default function AssistedLearningPage() {
  const token = useAuthStore((state) => state.token);
  const authHasHydrated = useAuthStore((state) => state.hasHydrated);
  const [modules, setModules] = useState<AssistedLearningModule[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authHasHydrated || !token) {
      return;
    }

    let cancelled = false;
    setStatus("loading");
    setError(null);

    void getAssistedLearningModules()
      .then((items) => {
        if (cancelled) return;
        setModules(items);
        setStatus("idle");
      })
      .catch((cause) => {
        if (cancelled) return;
        if (cause instanceof BackendAuthError) {
          setError("Your session expired. Sign in again to continue.");
        } else {
          setError(
            cause instanceof Error ? cause.message : "Failed to load modules",
          );
        }
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [authHasHydrated, token]);

  if (authHasHydrated && !token) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-6 py-12">
        <div className="rounded-2xl border bg-background p-8 shadow-sm">
          <div className="text-sm font-medium text-muted-foreground">
            Protected
          </div>
          <h1 className="mt-2 text-2xl font-semibold">Assisted Learning</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to access the protected learning modules.
          </p>
          <div className="mt-6 flex gap-3">
            <Button asChild>
              <Link href="/login?returnTo=%2Fassisted-learning">Sign in</Link>
            </Button>
            {isClerkEnabled ? (
              <Button asChild variant="outline">
                <Link href="/register?returnTo=%2Fassisted-learning">
                  Register
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="outline">
              <Link href="/">Back to chat</Link>
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh max-w-4xl px-6 py-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-muted-foreground">
            Protected
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Assisted Learning
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Backend-authenticated modules for the Milestone 4 auth surface.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/">Back to chat</Link>
        </Button>
      </div>

      {status === "loading" ? (
        <div className="mt-8 rounded-xl border bg-muted/20 p-6 text-sm text-muted-foreground">
          Loading modules...
        </div>
      ) : null}

      {error ? (
        <div className="mt-8 rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {modules.map((module) => (
          <div
            key={module.id}
            className="rounded-xl border bg-background p-5 shadow-sm"
          >
            <div className="text-sm font-medium">{module.title}</div>
            <p className="mt-2 text-sm text-muted-foreground">
              {module.description}
            </p>
            {module.href ? (
              <div className="mt-4 text-sm">
                <a className="underline" href={module.href}>
                  Open module
                </a>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </main>
  );
}
