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
import { ModalShell } from "@/components/sl/modal-shell";

/** UI cap on option slots only — the domain floor is 2 with no max (§4.5). */
const MAX_OPTIONS = 6;

const inputClass =
  "w-full border border-border bg-surface-1 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-jade focus:outline-none focus:ring-1 focus:ring-jade/40";

/**
 * DOM-007/008/009/017: new-bet form. Submit gating routes through the shared
 * validateBetDraft (single source of truth with the future server); a valid
 * draft lands in team-context's addBet mutator.
 */
export function CreateBetModal() {
  const { close } = useModal();
  const { addBet } = useTeam();

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
  const canSubmit = now != null && issues.length === 0;
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

  function submit() {
    if (!canSubmit) return;
    setSubmitError(null);
    const result = addBet({
      title,
      iconEmoji: emoji,
      options,
      closesAt: resolveClosesAt(Date.now()),
      maxWagerPerUser: maxWager,
    });
    if (result.ok) {
      close();
    } else {
      setSubmitError(result.error);
    }
  }

  const footerError = submitError ?? visibleIssue?.message ?? null;

  return (
    <ModalShell
      eyebrow="NEW BET"
      title="Create a bet"
      onClose={close}
      footer={
        <div className="space-y-2">
          {footerError && (
            <p className="text-xs text-negative">{footerError}</p>
          )}
          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className="cut-sm h-9 w-full px-5 text-xs font-semibold uppercase tracking-wide text-black bg-jade transition-[filter] motion-safe:hover:brightness-110 motion-safe:active:brightness-95 disabled:opacity-40 disabled:pointer-events-none"
          >
            Create bet
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Will it rain on Friday?"
            className={inputClass}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Icon
          </label>
          <input
            type="text"
            maxLength={2}
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            placeholder="🎲"
            className={cn(inputClass, "w-16 text-center")}
          />
          <p className="text-xs text-muted-foreground">
            Emoji for now — icon set later.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Options
          </label>
          <div className="space-y-2">
            {options.map((option, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="text"
                  value={option}
                  onChange={(e) => updateOption(index, e.target.value)}
                  placeholder={`Option ${index + 1}`}
                  className={inputClass}
                />
                {options.length > MIN_BET_OPTIONS && (
                  <button
                    type="button"
                    onClick={() => removeOption(index)}
                    aria-label="Remove option"
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
              + Add option
            </button>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Closes
          </label>
          <div className="flex flex-wrap gap-2">
            {CONFIG.BET_DURATION_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setPresetMinutes(preset.minutes)}
                className={cn(
                  "border px-3 py-1.5 font-mono text-xs tabular-nums transition-colors",
                  presetMinutes === preset.minutes
                    ? "border-jade bg-jade-wash text-jade"
                    : "border-border text-muted-foreground hover:border-border-strong",
                )}
              >
                {preset.label}
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
              Custom
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
            Max wager per user
          </label>
          <input
            type="number"
            min={1}
            value={maxWager}
            onChange={(e) => setMaxWager(Number(e.target.value) || 0)}
            className={cn(inputClass, "font-mono tabular-nums")}
          />
          <p className="text-xs text-muted-foreground">
            Default = onboarding grant.
          </p>
        </div>
      </div>
    </ModalShell>
  );
}
