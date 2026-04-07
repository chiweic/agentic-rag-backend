"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { useChatStore } from "@/lib/chat-store";

export type AuthProfile = {
  sub: string;
  userId: string;
  provider: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  exp: number | null;
};

export type ExternalAuthProfile = Omit<AuthProfile, "userId" | "provider"> & {
  provider: string;
};

type AuthState = {
  token: string | null;
  profile: AuthProfile | null;
  hasHydrated: boolean;
  authMessage: string | null;
  signInWithToken: (token: string) => void;
  syncExternalAuth: (args: {
    token: string | null;
    profile: ExternalAuthProfile | null;
  }) => void;
  signOut: (message?: string | null) => void;
  clearAuthMessage: () => void;
  setHasHydrated: (hasHydrated: boolean) => void;
};

type JwtPayload = {
  sub?: string;
  iss?: string;
  email?: string;
  name?: string;
  picture?: string;
  exp?: number;
};

const SESSION_STORAGE_KEY = "frontend-v1-auth-store";
const CLERK_SESSION_PROVIDER = "clerk";

let authTokenResolver: null | (() => Promise<string | null>) = null;
let authSessionInvalidator: null | ((message?: string) => Promise<void>) = null;

const decodeBase64Url = (value: string) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = padded.length % 4;
  const normalized = remainder ? padded + "=".repeat(4 - remainder) : padded;

  return atob(normalized);
};

const decodeJwtPayload = (token: string): JwtPayload => {
  const parts = token.split(".");
  if (parts.length < 2) {
    throw new Error("Malformed JWT");
  }

  return JSON.parse(decodeBase64Url(parts[1] ?? ""));
};

const providerFromIssuer = (issuer?: string) => {
  if (issuer === "https://dev.local") return "dev";
  if (issuer?.includes("clerk")) return CLERK_SESSION_PROVIDER;
  return "google";
};

const profileFromToken = (token: string): AuthProfile => {
  const payload = decodeJwtPayload(token);
  if (!payload.sub) {
    throw new Error("Token payload is missing sub");
  }

  const provider = providerFromIssuer(payload.iss);

  return {
    sub: payload.sub,
    userId: `${provider}:${payload.sub}`,
    provider,
    email: payload.email ?? null,
    name: payload.name ?? null,
    picture: payload.picture ?? null,
    exp: payload.exp ?? null,
  };
};

const clearChatState = () => {
  useChatStore.getState().resetForAuthBoundary();
};

const toAuthProfile = (
  profile: ExternalAuthProfile,
  fallbackToken: string | null,
): AuthProfile => ({
  ...profile,
  userId: `${profile.provider}:${profile.sub}`,
  exp:
    profile.exp ?? (fallbackToken ? profileFromToken(fallbackToken).exp : null),
});

export const setAuthTokenResolver = (
  resolver: null | (() => Promise<string | null>),
) => {
  authTokenResolver = resolver;
};

export const setAuthSessionInvalidator = (
  invalidator: null | ((message?: string) => Promise<void>),
) => {
  authSessionInvalidator = invalidator;
};

export const getStoredAuthToken = () => useAuthStore.getState().token;

export const getAuthToken = async () => {
  if (authTokenResolver) {
    return await authTokenResolver();
  }

  return getStoredAuthToken();
};

export const invalidateAuthSession = async (message?: string) => {
  if (authSessionInvalidator) {
    await authSessionInvalidator(message);
    return;
  }

  useAuthStore.getState().signOut(message);
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      profile: null,
      hasHydrated: false,
      authMessage: null,
      signInWithToken: (token) => {
        const profile = profileFromToken(token);
        clearChatState();
        set({
          token,
          profile,
          authMessage: null,
        });
      },
      syncExternalAuth: ({ token, profile }) => {
        const current = useAuthStore.getState();

        if (!token || !profile) {
          if (current.token || current.profile) {
            clearChatState();
          }
          set({
            token: null,
            profile: null,
            authMessage: null,
          });
          return;
        }

        const nextProfile = toAuthProfile(profile, token);
        if (current.profile?.userId !== nextProfile.userId) {
          clearChatState();
        }

        set({
          token,
          profile: nextProfile,
          authMessage: null,
        });
      },
      signOut: (message = null) => {
        clearChatState();
        set({
          token: null,
          profile: null,
          authMessage: message,
        });
      },
      clearAuthMessage: () => set({ authMessage: null }),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
    }),
    {
      name: SESSION_STORAGE_KEY,
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        token: state.token,
        profile: state.profile,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
