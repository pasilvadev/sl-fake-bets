import { describe, expect, it } from "vitest";
import { CONFIG } from "./config";
import { validateSignupDraft, type SignupDraft } from "./validation";

/**
 * plan-hosted-early-access.md Phase 1 task 5 — the first test for a validator
 * this plan adds, per the task's own instruction. `validateSignupDraft` is
 * new code, not a refactor of something already covered elsewhere, so it gets
 * its own file rather than folding into `duel.test.ts`'s broader fixture-based
 * suite.
 */

const VALID: SignupDraft = {
  displayName: "Duds",
  email: "duds@sl.local",
  password: "slfakebets",
};

describe("validateSignupDraft", () => {
  it("accepts a well-formed draft", () => {
    expect(validateSignupDraft(VALID)).toEqual([]);
  });

  it("requires a display name — the D8 carve-out this validator exists for", () => {
    const issues = validateSignupDraft({ ...VALID, displayName: "  " });
    expect(issues).toEqual([{ code: "display-name-required" }]);
  });

  it("rejects a malformed email", () => {
    const issues = validateSignupDraft({ ...VALID, email: "not-an-email" });
    expect(issues).toEqual([{ code: "email-invalid" }]);
  });

  it("rejects a blank email the same way as a malformed one", () => {
    const issues = validateSignupDraft({ ...VALID, email: "" });
    expect(issues).toEqual([{ code: "email-invalid" }]);
  });

  it("rejects a password shorter than CONFIG.MIN_PASSWORD_LENGTH, with the limit in values", () => {
    const short = "a".repeat(CONFIG.MIN_PASSWORD_LENGTH - 1);
    const issues = validateSignupDraft({ ...VALID, password: short });
    expect(issues).toEqual([
      { code: "password-too-short", values: { min: CONFIG.MIN_PASSWORD_LENGTH } },
    ]);
  });

  it("accepts a password exactly at the floor", () => {
    const atFloor = "a".repeat(CONFIG.MIN_PASSWORD_LENGTH);
    expect(validateSignupDraft({ ...VALID, password: atFloor })).toEqual([]);
  });

  it("reports every failing field at once, in field order", () => {
    const issues = validateSignupDraft({ displayName: "", email: "nope", password: "x" });
    expect(issues).toEqual([
      { code: "display-name-required" },
      { code: "email-invalid" },
      { code: "password-too-short", values: { min: CONFIG.MIN_PASSWORD_LENGTH } },
    ]);
  });
});
