/**
 * Short build identifier (plan-hosted-early-access.md D8) — what a shipped
 * consumer app shows in a footer, not an alpha banner. Rendered in the profile
 * menu's footer row and on the auth page footer so a bug report (team chat is
 * the alpha's feedback channel, D8) can name exactly which deploy it was seen
 * on.
 *
 * `NEXT_PUBLIC_BUILD_SHA` is copied from Vercel's own `VERCEL_GIT_COMMIT_SHA`
 * by `next.config.ts`'s `env` block at BUILD time — that copy is what makes
 * the value readable from client components, since only `NEXT_PUBLIC_*` names
 * survive into the browser bundle. The `?? process.env.VERCEL_GIT_COMMIT_SHA`
 * fallback is defence against the two ever drifting apart, not a path this
 * code expects to take. Empty locally and on a build that skips the `env`
 * copy: neither variable exists outside a Vercel build, and an empty tag is
 * the correct, honest rendering of "this is a local build," not a placeholder
 * to fill.
 */
export function buildTag(): string {
  const sha =
    process.env.NEXT_PUBLIC_BUILD_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA;
  return sha ? sha.slice(0, 7) : "";
}
