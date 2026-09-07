import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // @repo/shared ships raw TS source; Next transpiles it on the fly.
  transpilePackages: ["@repo/shared"],
  // Monorepo: stop Next from mis-inferring the workspace root for file tracing.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  typedRoutes: true,
};

/**
 * next-intl (plan-i18n-ptbr.md D1, Phase 1 task 1).
 *
 * The plugin's only job is pointing the App Router at `src/i18n/request.ts`,
 * the `getRequestConfig` that negotiates the locale per render. It composes
 * with the three options above and none of them is affected: D2 keeps the
 * `[locale]` segment out of the route tree, so `typedRoutes` still sees the
 * same five routes it always did.
 */
export default createNextIntlPlugin("./src/i18n/request.ts")(nextConfig);
