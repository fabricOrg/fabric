"use client";

import { Button } from "@app/ui/components/ui/button";
import { cn } from "@app/ui/lib/utils";
import { Minus, Plus } from "lucide-react";

/**
 * Bounded integer stepper — a −/value/+ strip in one bordered group.
 *
 * Deliberately not a number `<input>`: the values here are small and bounded (packs to buy, retries
 * to allow), and a free-text numeric field invites `-3`, `1e9`, and empty-string states that every
 * caller then has to defend against. The buttons disable at the bounds instead, so the value is
 * valid by construction and the limits are visible rather than discovered on submit.
 */
export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = null,
  disabled = false,
  label = "Quantity",
  className,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  /** `null` for unbounded. */
  max?: number | null;
  disabled?: boolean;
  /** Accessible name for the group and its buttons. */
  label: string;
  className?: string;
}) {
  const step = (delta: number) => {
    const next = value + delta;
    if (next < min || (max !== null && next > max)) return;
    onChange(next);
  };

  return (
    <div
      className={cn("inline-flex items-center border", className)}
      role="group"
      aria-label={label}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 rounded-none border-r"
        aria-label={`Decrease ${label.toLowerCase()}`}
        disabled={disabled || value <= min}
        onClick={() => step(-1)}
      >
        <Minus />
      </Button>
      {/* aria-live so a screen reader hears the new value after a press, not just the button name. */}
      <span
        aria-live="polite"
        className="inline-flex min-w-10 items-center justify-center px-1 text-sm tabular-nums"
      >
        {value}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 rounded-none border-l"
        aria-label={`Increase ${label.toLowerCase()}`}
        disabled={disabled || (max !== null && value >= max)}
        onClick={() => step(1)}
      >
        <Plus />
      </Button>
    </div>
  );
}
