import type { LogtoNextConfig } from "@logto/next";

export const logtoConfig: LogtoNextConfig = {
  endpoint: process.env["LOGTO_ENDPOINT"] ?? "http://localhost:3302",
  appId: process.env["LOGTO_APP_ID"] ?? "",
  appSecret: process.env["LOGTO_APP_SECRET"] ?? "",
  baseUrl: process.env["LOGTO_BASE_URL"] ?? "http://localhost:3100",
  cookieSecret:
    process.env["LOGTO_COOKIE_SECRET"] ??
    "default-dev-secret-change-me-in-prod",
  cookieSecure: process.env["NODE_ENV"] === "production",
  resources: process.env["LOGTO_RESOURCE"]
    ? [process.env["LOGTO_RESOURCE"]]
    : [],
};
