"use client";

import { cn } from "@app/ui/lib/utils";

/**
 * Multi-select over a KNOWN vocabulary, kept as the comma-joined string the offer form already
 * submits. Eligibility values are not free text — a vendor or destination with no provider-cost rate
 * is refused at publish, so typing one can only produce a failed publish. Offering exactly the
 * priceable values makes the invalid state unreachable instead of merely reported.
 */
export function EligibilityChips({
  value,
  options,
  onChange,
  anyLabel,
  emptyHint,
  describedBy,
}: {
  value: string;
  options: readonly string[];
  onChange: (next: string) => void;
  anyLabel: string;
  emptyHint: string;
  describedBy?: string;
}) {
  const selected = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (options.length === 0) {
    return <p className="text-muted-foreground text-xs">{emptyHint}</p>;
  }

  function toggle(option: string) {
    const next = selected.includes(option)
      ? selected.filter((entry) => entry !== option)
      : [...selected, option];
    onChange(next.join(", "));
  }

  return (
    <div className="flex flex-wrap gap-1.5" aria-describedby={describedBy}>
      {options.map((option) => {
        const active = selected.includes(option);
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(option)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-background hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {option}
          </button>
        );
      })}
      {selected.length === 0 && (
        <span className="self-center text-muted-foreground text-xs">
          {anyLabel}
        </span>
      )}
    </div>
  );
}
