import { describe, expect, it } from "vitest";
import {
  BET_EMOJI,
  BET_EMOJI_CATEGORIES,
  betEmojiFor,
  searchBetEmoji,
} from "./emoji-catalog";

/**
 * The catalog is a few hundred hand-authored glyphs, and the failure mode of a
 * table like that is not a crash — it is one entry that renders as an empty box
 * or as two half-emoji side by side on somebody's phone, which nobody notices
 * because the picker still "works". So the rules `emoji-catalog.ts` states in
 * prose are asserted here, per entry, mechanically.
 */

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

function graphemeCount(s: string): number {
  return [...graphemes.segment(s)].length;
}

function codepoints(s: string): number[] {
  return [...s].map((c) => c.codePointAt(0)!);
}

function hex(s: string): string {
  return codepoints(s)
    .map((c) => c.toString(16).toUpperCase().padStart(4, "0"))
    .join(" ");
}

/**
 * Built with `new RegExp` rather than written as a literal on purpose: the `v`
 * flag is an ES2024 feature and this package targets es2022, so a literal is a
 * compile error (TS1501) even though every runtime the tests and the app run on
 * supports it. The construction is hoisted out of the loop because it is the
 * one expensive thing in a per-entry assertion.
 */
const RGI_EMOJI = new RegExp("^\\p{RGI_Emoji}$", "v");

const ZWJ = 0x200d;
const COMBINING_KEYCAP = 0x20e3;
const REGIONAL_INDICATOR = [0x1f1e6, 0x1f1ff] as const;
const SKIN_TONE = [0x1f3fb, 0x1f3ff] as const;

/**
 * "Not newer than Emoji 12.1", as far as a codepoint test can express it.
 *
 * There is no Unicode character property for the emoji version an entry was
 * introduced in, so this is a screen rather than a proof, aimed at the
 * additions an author actually reaches for:
 *
 *   * The whole `U+1FA70..U+1FAFF` block (Symbols and Pictographs Extended-A).
 *     Almost everything ever assigned in there is Emoji 13.0 or later — the
 *     2020-onward hands, hearts, tools and faces. Banning the block costs a
 *     handful of Emoji 12.0 entries (🩰 🩸 🪀 🪁) and buys a hard floor.
 *   * The 13.0/14.0/15.0 additions that live OUTSIDE that block, listed
 *     one by one below, because a brief that says "roller skate" or "pinched
 *     fingers" leads straight to one of them.
 *
 * A 2021 emoji is a tofu box on a 2019 phone, and a tofu box in a bet's icon
 * slot is indistinguishable from a bug in the app.
 */
const EXTENDED_A = [0x1fa70, 0x1faff] as const;
const TOO_NEW_OUTSIDE_EXTENDED_A = new Set([
  0x1f972, // 🥲 smiling face with tear (13.0)
  0x1f977, // 🥷 ninja (13.0)
  0x1f978, // 🥸 disguised face (13.0)
  0x1f979, // 🥹 face holding back tears (14.0)
  0x1f9a3, // 🦣 mammoth (13.0)
  0x1f9a4, // 🦤 dodo (13.0)
  0x1f9ab, // 🦫 beaver (13.0)
  0x1f9ac, // 🦬 bison (13.0)
  0x1f9ad, // 🦭 seal (13.0)
  0x1f9cb, // 🧋 bubble tea (13.0)
  0x1f9cc, // 🧌 troll (14.0)
  0x1f6d6, // 🛖 hut (13.0)
  0x1f6d7, // 🛗 elevator (13.0)
  0x1f6dc, // 🛜 wireless (15.0)
  0x1f6dd, // 🛝 playground slide (14.0)
  0x1f6de, // 🛞 wheel (14.0)
  0x1f6df, // 🛟 ring buoy (14.0)
  0x1f6fb, // 🛻 pickup truck (13.0)
  0x1f6fc, // 🛼 roller skate (13.0)
  0x1f90c, // 🤌 pinched fingers (13.0)
]);

function inRange(cp: number, [lo, hi]: readonly [number, number]): boolean {
  return cp >= lo && cp <= hi;
}

describe("BET_EMOJI_CATEGORIES shape", () => {
  it("has categories, each with a unique id, a label and entries", () => {
    expect(BET_EMOJI_CATEGORIES.length).toBeGreaterThan(0);

    const ids = BET_EMOJI_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const category of BET_EMOJI_CATEGORIES) {
      expect(category.id, `category id: ${JSON.stringify(category)}`).toMatch(
        /^[a-z][a-z-]*$/,
      );
      expect(category.label.trim(), `label of ${category.id}`).not.toBe("");
      expect(category.emoji.length, `entries in ${category.id}`).toBeGreaterThan(
        0,
      );
    }
  });

  it("offers materially more icons than the 8-icon avatar set it was measured against", () => {
    // The actual ask was "a lot more options than the profile one has", and
    // that set is `avatar-icons.ts`'s eight. A floor rather than an exact
    // count, so adding entries never breaks the test — but dropping the
    // catalog back to a token handful does.
    expect(BET_EMOJI.length).toBeGreaterThanOrEqual(200);
  });

  it("never repeats a char across the whole catalog", () => {
    const seen = new Map<string, string>();
    for (const category of BET_EMOJI_CATEGORIES) {
      for (const entry of category.emoji) {
        const previous = seen.get(entry.char);
        expect(
          previous,
          `${entry.char} (${hex(entry.char)}) is in both "${previous}" and "${category.id}"`,
        ).toBeUndefined();
        seen.set(entry.char, category.id);
      }
    }
  });
});

describe("every entry renders as one emoji", () => {
  it.each(BET_EMOJI.map((e) => [e.char, e.name, e] as const))(
    "%s (%s)",
    (char, name, entry) => {
      expect(graphemeCount(char), `${name} is not one grapheme cluster`).toBe(1);

      // RGI = "recommended for general interchange", i.e. the set a platform
      // is expected to have a glyph for. It also rejects a text-default
      // codepoint that forgot its U+FE0F, which is the defect that renders
      // monochrome on one OS and in color on another.
      expect(
        RGI_EMOJI.test(char),
        `${name} (${hex(char)}) is not an RGI emoji sequence`,
      ).toBe(true);

      for (const cp of codepoints(char)) {
        expect(cp, `${name} (${hex(char)}) contains a ZWJ`).not.toBe(ZWJ);
        expect(
          cp,
          `${name} (${hex(char)}) contains a combining keycap`,
        ).not.toBe(COMBINING_KEYCAP);
        expect(
          inRange(cp, REGIONAL_INDICATOR),
          `${name} (${hex(char)}) is a regional-indicator flag`,
        ).toBe(false);
        expect(
          inRange(cp, SKIN_TONE),
          `${name} (${hex(char)}) carries a skin-tone modifier`,
        ).toBe(false);
        expect(
          inRange(cp, EXTENDED_A),
          `${name} (${hex(char)}) is in Symbols and Pictographs Extended-A, which is Emoji 13.0+`,
        ).toBe(false);
        expect(
          TOO_NEW_OUTSIDE_EXTENDED_A.has(cp),
          `${name} (${hex(char)}) was added after Emoji 12.1`,
        ).toBe(false);
      }
    },
  );
});

describe("every entry is searchable", () => {
  it.each(BET_EMOJI.map((e) => [e.name, e] as const))("%s", (name, entry) => {
    expect(name, "name is not 1-3 lowercase ascii words").toMatch(
      /^[a-z0-9]+( [a-z0-9]+){0,2}$/,
    );

    const words = entry.keywords.split(" ");
    expect(
      entry.keywords,
      `keywords of ${name} are not 3-8 lowercase ascii words`,
    ).toMatch(/^[a-z0-9]+( [a-z0-9]+)+$/);
    expect(words.length, `keyword count of ${name}`).toBeGreaterThanOrEqual(3);
    expect(words.length, `keyword count of ${name}`).toBeLessThanOrEqual(8);
    expect(new Set(words).size, `${name} repeats a keyword`).toBe(words.length);

    // Typing the name has to put THIS entry in the top rank, not merely
    // somewhere in the results. Asserting only "is in the results" would be
    // tautological — search matches on the name, and a name always contains
    // itself — so the assertion that carries weight is the ranking: if
    // `searchBetEmoji` ever stops matching on `name`, this entry drops to
    // rank 2 behind every keyword hit, and the picker starts burying the
    // exact thing the user typed.
    const results = searchBetEmoji(name);
    const rank0 = results.filter((r) => r.name.startsWith(name));
    expect(
      rank0.some((r) => r.char === entry.char),
      `searching "${name}" does not rank ${entry.char} first`,
    ).toBe(true);
    expect(
      results.indexOf(entry) < rank0.length,
      `${entry.char} is ranked below a keyword-only match for its own name`,
    ).toBe(true);
  });

  it("gives every entry a name no other entry uses", () => {
    // Two tiles with the same `aria-label` is a real defect, not a cosmetic
    // one: a screen-reader user is told "dog, button" twice and has no way to
    // tell which is 🐶 and which is 🐕. Checked across the WHOLE catalog, not
    // per category — the picker renders every category in one grid.
    const byName = new Map<string, string[]>();
    for (const entry of BET_EMOJI) {
      byName.set(entry.name, [...(byName.get(entry.name) ?? []), entry.char]);
    }
    const collisions = [...byName].filter(([, chars]) => chars.length > 1);
    expect(
      collisions.map(([name, chars]) => `${name}: ${chars.join(" ")}`),
    ).toEqual([]);
  });

  it("gives every category a label no other category uses", () => {
    const labels = BET_EMOJI_CATEGORIES.map((c) => c.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("betEmojiFor", () => {
  it("round-trips every catalog entry", () => {
    for (const entry of BET_EMOJI) {
      expect(betEmojiFor(entry.char)).toEqual(entry);
    }
  });

  it("is undefined for a value the catalog does not carry", () => {
    // A bet created before the catalog existed, and a fixture emoji the
    // catalog deliberately excludes (mock-data.ts's pirate flag is a ZWJ
    // sequence). Both still render; neither can be named.
    expect(betEmojiFor("")).toBeUndefined();
    expect(betEmojiFor("icon-dice")).toBeUndefined();
    expect(betEmojiFor("🏴‍☠️")).toBeUndefined();
  });
});

describe("searchBetEmoji", () => {
  it("returns the whole catalog for an empty or whitespace query", () => {
    expect(searchBetEmoji("")).toEqual(BET_EMOJI);
    expect(searchBetEmoji("   ")).toEqual(BET_EMOJI);
  });

  it("returns nothing for a query nothing matches", () => {
    expect(searchBetEmoji("zzzzqqq")).toEqual([]);
  });

  it("is case- and whitespace-insensitive", () => {
    const plain = searchBetEmoji("fire");
    expect(searchBetEmoji("  FIRE ")).toEqual(plain);
    expect(plain.length).toBeGreaterThan(0);
  });

  it("ranks a name-prefix match above a keyword-only match", () => {
    // Every entry whose NAME starts with the needle has to come before the
    // first entry that only matched on a keyword. Asserted structurally
    // rather than against a specific emoji, so re-authoring the catalog
    // cannot quietly invalidate the test.
    for (const needle of ["fire", "car", "star", "cat", "money"]) {
      const results = searchBetEmoji(needle);
      const ranks = results.map((entry) =>
        entry.name.startsWith(needle) ? 0 : entry.name.includes(needle) ? 1 : 2,
      );
      expect(
        [...ranks].sort((a, b) => a - b),
        `results for "${needle}" are out of rank order`,
      ).toEqual(ranks);
    }
  });

  it("finds an entry by a keyword that is not part of its name", () => {
    // The point of the keywords column: someone typing what they mean rather
    // than what the thing is called still gets there.
    const hits = searchBetEmoji("football");
    expect(hits.length).toBeGreaterThan(0);
  });

  it("never returns an entry twice", () => {
    for (const needle of ["a", "e", "s", "ball", "face"]) {
      const chars = searchBetEmoji(needle).map((e) => e.char);
      expect(new Set(chars).size, `duplicates for "${needle}"`).toBe(
        chars.length,
      );
    }
  });
});
