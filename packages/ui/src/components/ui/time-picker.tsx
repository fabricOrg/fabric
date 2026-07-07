"use client";

import { cn } from "@app/ui/lib/utils";
import { Clock } from "lucide-react";
import { useId } from "react";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function clamp(value: number, max: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > max) return max;
  return value;
}

/**
 * Segmented HH:MM time picker (24-hour), replacing the native `type="time"` control for a consistent
 * look across apps. Controlled by an "HH:mm" string (empty string = unset); every edit emits a
 * normalised, zero-padded, clamped value so callers never see a half-typed time.
 */
export function TimePicker({
  value,
  onChange,
  disabled,
  className,
  "aria-label": ariaLabel = "Time",
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const groupId = useId();
  const [hh = "", mm = ""] = value ? value.split(":") : [];

  function emit(nextHour: string, nextMinute: string) {
    const h = clamp(Number.parseInt(nextHour || "0", 10), 23);
    const m = clamp(Number.parseInt(nextMinute || "0", 10), 59);
    onChange(`${pad(h)}:${pad(m)}`);
  }

  const segment =
    "w-7 bg-transparent text-center font-mono tabular-nums outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed";

  return (
    <div
      role="group"
      aria-labelledby={groupId}
      className={cn(
        "inline-flex h-9 items-center gap-0.5 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <span id={groupId} className="sr-only">
        {ariaLabel}
      </span>
      <input
        aria-label="Hour"
        inputMode="numeric"
        maxLength={2}
        placeholder="--"
        disabled={disabled}
        value={hh}
        onChange={(e) => emit(e.target.value.replace(/\D/g, ""), mm)}
        className={segment}
      />
      <span aria-hidden className="text-muted-foreground">
        :
      </span>
      <input
        aria-label="Minute"
        inputMode="numeric"
        maxLength={2}
        placeholder="--"
        disabled={disabled}
        value={mm}
        onChange={(e) => emit(hh, e.target.value.replace(/\D/g, ""))}
        className={segment}
      />
      <Clock className="ml-1 size-4 shrink-0 text-muted-foreground" />
    </div>
  );
}
