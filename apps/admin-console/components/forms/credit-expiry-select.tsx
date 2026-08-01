"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";

/** Sentinel for "no expiry"; the form state stores an empty string, which the API reads as null. */
const NEVER = "never";

const PRESETS = [
  { value: "30", label: "30 days after purchase" },
  { value: "60", label: "60 days after purchase" },
  { value: "90", label: "90 days after purchase" },
  { value: "180", label: "180 days after purchase" },
  { value: "365", label: "1 year after purchase" },
] as const;

/**
 * Credit expiry as a CHOICE rather than a number to type.
 *
 * "Blank means never" is invisible: an empty box looks unfilled, not deliberate, and the reader
 * cannot tell whether a value is missing or the offer genuinely has no expiry. Making "Never
 * expires" a selectable option states the decision, and a fixed set of periods keeps a typo from
 * publishing a 3-day package as 3650 days — the difference between the two is a customer's money.
 */
export function CreditExpirySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const selected = value.trim() === "" ? NEVER : value.trim();
  const known = PRESETS.some((preset) => preset.value === selected);

  return (
    <Select
      value={known || selected === NEVER ? selected : undefined}
      onValueChange={(next) => onChange(next === NEVER ? "" : next)}
    >
      <SelectTrigger>
        <SelectValue placeholder={`${selected} days after purchase`} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NEVER}>Never expires</SelectItem>
        {PRESETS.map((preset) => (
          <SelectItem key={preset.value} value={preset.value}>
            {preset.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
