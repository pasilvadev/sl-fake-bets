import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @repo/shared ships raw TS source; Next transpiles it on the fly.
  transpilePackages: ["@repo/shared"],
  // Monorepo: stop Next from mis-inferring the workspace root for file tracing.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  typedRoutes: true,
};

export default nextConfig;
