"use client";

import { cn } from "@app/ui/lib/utils";
import type { ReactNode } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Optional per-option accessible name, when `label` is an icon or an abbreviation. */
  srLabel?: string;
}

/**
 * A hard-edged segmented control: two or three mutually exclusive views in one bordered strip.
 *
 * `radiogroup` rather than a row of buttons, because that is what this is — picking one of a known
 * set, not firing N independent actions. Screen readers then announce "1 of 3" and arrow keys move
 * between options, which a `role="group"` of plain buttons does not give you. Every hand-rolled
 * copy of this widget in the apps got that wrong in a different way, which is why it lives here.
 *
 *   <SegmentedToggle value={env} onChange={setEnv}
 *     options={[{value:"sandbox",label:"Sandbox"},{value:"live",label:"Live"}]} label="Key environment" />
 */
export function SegmentedToggle<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "sm",
  className,
}: {
  value: T;
  onChange: (next: T) => void;
  options: readonly SegmentedOption<T>[];
  /** Accessible name for the whole control. */
  label: string;
  /** `sm` for inline table/card controls, `md` for a page-level view switch. */
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex w-fit border", className)}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "border-r transition-colors last:border-r-0",
              size === "sm"
                ? "px-3 py-1 text-xs"
                : "px-5.5 py-2.5 font-display text-sm uppercase tracking-[0.1em]",
              selected
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-primary/8 hover:text-foreground",
            )}
          >
            {option.label}
            {option.srLabel ? (
              <span className="sr-only">{option.srLabel}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
