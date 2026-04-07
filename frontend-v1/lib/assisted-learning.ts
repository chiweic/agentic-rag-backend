"use client";

import { getAuthToken, invalidateAuthSession } from "@/lib/auth-store";
import { BackendAuthError, BackendRequestError } from "@/lib/backend-threads";

const BACKEND_BASE_URL =
  process.env.NEXT_PUBLIC_BACKEND_BASE_URL?.replace(/\/$/, "") ??
  "http://localhost:8081";

export type AssistedLearningModule = {
  id: string;
  title: string;
  description: string;
  href?: string;
  slug?: string;
};

export const getAssistedLearningModules = async () => {
  const token = await getAuthToken();
  const response = await fetch(
    `${BACKEND_BASE_URL}/assisted-learning/modules`,
    {
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
  );

  if (!response.ok) {
    const message = await response.text();
    if (response.status === 401) {
      await invalidateAuthSession("Your session expired. Sign in again.");
      throw new BackendAuthError(message || "Unauthorized");
    }
    throw new BackendRequestError(response.status, message || "Request failed");
  }

  const payload = (await response.json()) as {
    modules: AssistedLearningModule[];
  };
  return payload.modules;
};
