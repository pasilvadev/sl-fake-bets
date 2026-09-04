"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "cn";

/**
 * Modal chrome (§5.4): flat black/75 backdrop (no blur, click closes),
 * Escape closes, floating N2 panel with a real border, desktop centered
 * (one cut-md corner) / mobile bottom sheet (mirrored cut-md, drag handle
 * bar). The one sanctioned box-shadow in the whole app lives here.
 */
export function ModalShell({
  eyebrow,
  title,
  onClose,
  children,
  footer,
  danger,
}: {
  eyebrow: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  danger?: boolean;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className={cn(
          "relative flex max-h-[85vh] w-full flex-col overflow-hidden border border-border-strong bg-surface-2 shadow-[0_8px_24px_-4px_rgba(0,0,0,0.45)]",
          "cut-md",
          "sm:max-w-lg",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* the cut line — 1px brand edge across the very top */}
        <div
          className={cn(
            "absolute inset-x-0 top-0 h-px",
            danger ? "bg-ember-border" : "bg-jade",
          )}
        />

        {/* mobile drag handle — plain bar, not a rounded pill */}
        <div className="flex justify-center pt-2.5 sm:hidden">
          <div className="h-1 w-10 bg-border-strong" />
        </div>

        <div className="flex items-start justify-between gap-4 px-6 pt-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {eyebrow}
            </p>
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>

        {footer && (
          <div className="border-t border-border px-6 py-4">{footer}</div>
        )}
      </div>
    </div>
  );
}
