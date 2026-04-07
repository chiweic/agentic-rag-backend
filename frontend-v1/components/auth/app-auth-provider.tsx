"use client";

import { ClerkProvider, useAuth, useClerk, useUser } from "@clerk/nextjs";
import { useEffect } from "react";
import {
  setAuthSessionInvalidator,
  setAuthTokenResolver,
  useAuthStore,
} from "@/lib/auth-store";
import {
  CLERK_JWT_TEMPLATE,
  CLERK_PUBLISHABLE_KEY,
  isClerkEnabled,
} from "@/lib/clerk";

const buildClerkProfile = (user: ReturnType<typeof useUser>["user"]) => {
  if (!user) return null;

  return {
    sub: user.id,
    provider: "clerk",
    email: user.primaryEmailAddress?.emailAddress ?? null,
    name: user.fullName ?? user.username ?? null,
    picture: user.imageUrl ?? null,
    exp: null,
  };
};

const getClerkBackendToken = async (
  getToken: ReturnType<typeof useAuth>["getToken"],
) => {
  return (
    (await getToken(
      CLERK_JWT_TEMPLATE ? { template: CLERK_JWT_TEMPLATE } : undefined,
    )) ?? null
  );
};

function ClerkAuthSync({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { signOut } = useClerk();
  const { user } = useUser();
  const syncExternalAuth = useAuthStore((state) => state.syncExternalAuth);
  const localSignOut = useAuthStore((state) => state.signOut);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setAuthTokenResolver(null);
      return;
    }

    setAuthTokenResolver(async () => await getClerkBackendToken(getToken));
    return () => {
      setAuthTokenResolver(null);
    };
  }, [getToken, isLoaded, isSignedIn]);

  useEffect(() => {
    setAuthSessionInvalidator(async (message) => {
      localSignOut(message ?? "Your session expired. Sign in again.");
      await signOut({ redirectUrl: "/login" });
    });

    return () => {
      setAuthSessionInvalidator(null);
    };
  }, [localSignOut, signOut]);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn || !user) {
      syncExternalAuth({ token: null, profile: null });
      return;
    }

    let cancelled = false;

    void getClerkBackendToken(getToken)
      .then((token) => {
        if (cancelled) return;
        syncExternalAuth({
          token: token ?? null,
          profile: buildClerkProfile(user),
        });
      })
      .catch(() => {
        if (cancelled) return;
        syncExternalAuth({ token: null, profile: null });
      });

    return () => {
      cancelled = true;
    };
  }, [getToken, isLoaded, isSignedIn, syncExternalAuth, user]);

  return <>{children}</>;
}

export function AppAuthProvider({ children }: { children: React.ReactNode }) {
  if (!isClerkEnabled) {
    return <>{children}</>;
  }

  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      signInUrl="/login"
      signUpUrl="/register"
      afterSignOutUrl="/"
    >
      <ClerkAuthSync>{children}</ClerkAuthSync>
    </ClerkProvider>
  );
}
