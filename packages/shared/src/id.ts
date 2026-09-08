/**
 * Id + invite-code generation. Entity ids follow the fixture shape
 * (`b-…`, `w-…`, `tx-…`, `t-…`); invite codes get an explicit uniqueness
 * check against the existing code set (pure, given that set). That set still
 * only ever grows even after `plan-invite-links.md` (D1/D3): a revoked or
 * expired code is never reissued, only ever excluded from what a *read*
 * returns, so uniqueness still has to span every code a team has ever held,
 * not just its currently-live ones.
 */

// Typed accessor: this package's tsconfig lib is bare es2022 (no DOM/Node
// globals), but every target runtime (browser, Node 22) ships Web Crypto.
const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } })
  .crypto;

/** `${prefix}-<uuid>` — collision-safe entity id (bet/wager/transaction/team). */
export function generateId(prefix: string): string {
  const uuid =
    typeof webCrypto?.randomUUID === "function"
      ? webCrypto.randomUUID()
      : // Non-crypto fallback for exotic runtimes; uniqueness, not secrecy.
        `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
  return `${prefix}-${uuid}`;
}

/** Lookalike-free alphabet (no 0/o, 1/l/i) — codes get read aloud and retyped. */
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_GROUPS = 2;
const CODE_GROUP_LENGTH = 4;
const MAX_CODE_ATTEMPTS = 100;

/**
 * Generate an invite code (`xxxx-xxxx`) not present in `existingCodes`.
 * Pure given the code set and the injectable RNG (testable). 31^8 ≈ 850
 * billion combinations — the uniqueness check is explicit anyway.
 */
export function generateInviteCode(
  existingCodes: Iterable<string>,
  random: () => number = Math.random,
): string {
  const taken = new Set(existingCodes);

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const groups: string[] = [];
    for (let g = 0; g < CODE_GROUPS; g++) {
      let group = "";
      for (let c = 0; c < CODE_GROUP_LENGTH; c++) {
        group += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
      }
      groups.push(group);
    }
    const code = groups.join("-");
    if (!taken.has(code)) return code;
  }

  throw new Error("Could not generate a unique invite code");
}
