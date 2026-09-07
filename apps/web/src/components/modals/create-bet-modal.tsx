"use client";

import { useState } from "react";
import { cn } from "cn";
import {
  CONFIG,
  DEFAULT_MAX_WAGER,
  MIN_BET_OPTIONS,
  validateBetDraft,
} from "@repo/shared";
import { useModal } from "@/lib/modal-context";
import { useTeam } from "@/lib/team-context";
import { useNow } from "@/lib/use-now";
import { useTranslations } from "next-intl";
import { useErrorText } from "@/lib/use-error-text";
import { EmojiPicker } from "@/components/sl/emoji-picker";
import { ModalShell } from "@/components/sl/modal-shell";

/** UI cap on option slots only — the domain floor is 2 with no max (§4.5). */
const MAX_OPTIONS = 6;

const inputClass =
  "w-full border border-border bg-surface-1 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-jade focus:outline-none focus:ring-1 focus:ring-jade/40";

/**
 * DOM-007/008/009/017: new-bet form. Submit gating routes through the shared
 * validateBetDraft — the same rules the `create_bet` RPC enforces, so the form
 * can refuse a bad draft before a round trip and the server still decides.
 */
/**
 * A duration chip's text, derived from its `minutes` (UX-027, Phase 3).
 *
 * `BetDurationPreset` lost its `label` because a chip has to read "24 hours"
 * or "24 horas" depending on who is looking, and `@repo/shared` cannot know
 * which. Deriving it also removes a way for open decision #2 to go wrong: the
 * owner retunes `minutes` and the chip follows, where a hand-typed label
 * would have quietly disagreed with the number it named.
 *
 * DAYS only for a whole number of days GREATER THAN ONE; everything else reads
 * in hours. That rule is not arbitrary — it is what reproduces the three
 * shipped labels exactly ("1 hour", "24 hours", "7 days"), and Phase 3's exit
 * criterion is that extraction leaves the English unchanged in meaning. "1 day"
 * for the 24-hour preset would be the same duration and different words, which
 * is an editing pass wearing an extraction's clothes.
 *
 * Both arms are ICU `plural` blocks, so "1 hour" and "24 horas" both come out
 * right without the caller knowing anything about either language.
 */
function durationLabel(
  t: ReturnType<typeof useTranslations<"createBetModal">>,
  minutes: number,
): string {
  const MINUTES_PER_DAY = 60 * 24;
  const wholeDays = minutes / MINUTES_PER_DAY;

  return Number.isInteger(wholeDays) && wholeDays > 1
    ? t("durationDays", { count: wholeDays })
    : t("durationHours", { count: Math.round(minutes / 60) });
}

export function CreateBetModal() {
  const { close } = useModal();
  const { addBet } = useTeam();

  const { errorText, issueText } = useErrorText();
  const t = useTranslations("createBetModal");
  const [title, setTitle] = useState("");
  const [emoji, setEmoji] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const defaultPreset = CONFIG.BET_DURATION_PRESETS.find((p) => p.isDefault);
  const [presetMinutes, setPresetMinutes] = useState<number | "custom">(
    defaultPreset?.minutes ?? CONFIG.BET_DURATION_PRESETS[0].minutes,
  );
  const [customCloseAt, setCustomCloseAt] = useState("");
  const [maxWager, setMaxWager] = useState<number>(DEFAULT_MAX_WAGER);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const now = useNow();

  // Preset => clock + duration; custom => the datetime-local value (local
  // time) as ISO. "" while unset/unparsable so validation flags it, never throws.
  function resolveClosesAt(nowMs: number): string {
    if (presetMinutes === "custom") {
      if (!customCloseAt) return "";
      const parsed = new Date(customCloseAt);
      return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
    }
    return new Date(nowMs + presetMinutes * 60_000).toISOString();
  }

  // Render-time gating routes through the shared validateBetDraft, driven by
  // the mounted clock (useNow is null on the very first render — the button
  // simply starts disabled); addBet revalidates with a fresh clock on submit.
  const issues =
    now == null
      ? []
      : validateBetDraft(
          { title, options, closesAt: resolveClosesAt(now), maxWagerPerUser: maxWager },
          now,
        );
  const canSubmit = now != null && issues.length === 0 && !pending;
  const visibleIssue = issues.find(
    (i) => i.code === "closes-at-past" || i.code === "max-wager-invalid",
  );

  function updateOption(index: number, value: string) {
    setOptions((prev) => prev.map((o, i) => (i === index ? value : o)));
  }

  function addOption() {
    setOptions((prev) => (prev.length >= MAX_OPTIONS ? prev : [...prev, ""]));
  }

  function removeOption(index: number) {
    setOptions((prev) =>
      prev.length <= MIN_BET_OPTIONS ? prev : prev.filter((_, i) => i !== index),
    );
  }

  // Async since roadmap Phase 6: the bet row and its option rows are created
  // by one Postgres transaction (the `create_bet` RPC), which is also what
  // enforces DOM-007's two-option floor server-side.
  async function submit() {
    if (!canSubmit) return;
    setSubmitError(null);
    setPending(true);
    const result = await addBet({
      title,
      iconEmoji: emoji,
      options,
      closesAt: resolveClosesAt(Date.now()),
      maxWagerPerUser: maxWager,
    });
    setPending(false);
    if (result.ok) {
      close();
    } else {
      setSubmitError(errorText(result));
    }
  }

  const footerError =
    submitError ?? (visibleIssue ? issueText(visibleIssue) : null);

  return (
    <ModalShell
      eyebrow={t("eyebrow")}
      title={t("title")}
      onClose={close}
      footer={
        <div className="space-y-2">
          {footerError && (
            <p className="text-xs text-negative">{footerError}</p>
          )}
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
            className="cut-sm h-9 w-full px-5 text-xs font-semibold uppercase tracking-wide text-black bg-jade transition-[filter] motion-safe:hover:brightness-110 motion-safe:active:brightness-95 disabled:opacity-40 disabled:pointer-events-none"
          >
            {pending ? t("submitting") : t("submit")}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("titleLabel")}
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("titlePlaceholder")}
            className={inputClass}
          />
        </div>

        <div className="space-y-1.5">
          {/* A span, not a label: the picker is a grid of buttons with no one
              control to point `htmlFor` at — the same reason the avatar grid in
              `profile-fields.tsx` labels itself this way. */}
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("iconLabel")}
          </span>
          <EmojiPicker value={emoji} onChange={setEmoji} />
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("optionsLabel")}
          </label>
          <div className="space-y-2">
            {options.map((option, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="text"
                  value={option}
                  onChange={(e) => updateOption(index, e.target.value)}
                  placeholder={t("optionPlaceholder", { index: index + 1 })}
                  className={inputClass}
                />
                {options.length > MIN_BET_OPTIONS && (
                  <button
                    type="button"
                    onClick={() => removeOption(index)}
                    aria-label={t("removeOption")}
                    className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
          {options.length < MAX_OPTIONS && (
            <button
              type="button"
              onClick={addOption}
              className="text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
            >
              {t("addOption")}
            </button>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("closesLabel")}
          </label>
          <div className="flex flex-wrap gap-2">
            {CONFIG.BET_DURATION_PRESETS.map((preset) => (
              <button
                key={preset.minutes}
                type="button"
                onClick={() => setPresetMinutes(preset.minutes)}
                className={cn(
                  "border px-3 py-1.5 font-mono text-xs tabular-nums transition-colors",
                  presetMinutes === preset.minutes
                    ? "border-jade bg-jade-wash text-jade"
                    : "border-border text-muted-foreground hover:border-border-strong",
                )}
              >
                {durationLabel(t, preset.minutes)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPresetMinutes("custom")}
              className={cn(
                "border px-3 py-1.5 text-xs font-medium transition-colors",
                presetMinutes === "custom"
                  ? "border-jade bg-jade-wash text-jade"
                  : "border-border text-muted-foreground hover:border-border-strong",
              )}
            >
              {t("custom")}
            </button>
          </div>
          {presetMinutes === "custom" && (
            <input
              type="datetime-local"
              value={customCloseAt}
              onChange={(e) => setCustomCloseAt(e.target.value)}
              className={cn(inputClass, "mt-2")}
            />
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("maxWagerLabel")}
          </label>
          <input
            type="number"
            min={1}
            value={maxWager}
            onChange={(e) => setMaxWager(Number(e.target.value) || 0)}
            className={cn(inputClass, "font-mono tabular-nums")}
          />
          <p className="text-xs text-muted-foreground">
            {t("maxWagerHint")}
          </p>
        </div>
      </div>
    </ModalShell>
  );
}
