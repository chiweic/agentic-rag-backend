export const CLERK_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
export const CLERK_JWT_TEMPLATE =
  process.env.NEXT_PUBLIC_CLERK_JWT_TEMPLATE ?? "";
export const FORCE_DISABLE_CLERK =
  process.env.NEXT_PUBLIC_FORCE_DISABLE_CLERK === "true";

export const isClerkEnabled =
  !FORCE_DISABLE_CLERK && Boolean(CLERK_PUBLISHABLE_KEY);
