import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.50.253", "server"],
  // Emit a self-contained runtime folder at `.next/standalone` so the
  // Dockerfile (multi-stage runner) can ship a ~150MB image without
  // node_modules. See docs/deploy.md §A1.
  output: "standalone",
};

export default nextConfig;
