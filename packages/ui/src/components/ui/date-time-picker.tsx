"use client";

import { Button } from "@app/ui/components/ui/button";
import { Calendar } from "@app/ui/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@app/ui/components/ui/popover";
import { TimePicker } from "@app/ui/components/ui/time-picker";
import { CalendarIcon } from "lucide-react";
import { useState } from "react";

/** "8 July 2026" — long human date for the trigger label. */
function longDate(d: Date): string {
  return d.toLocaleDateString("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** "HH:mm" (zero-padded, 24h) for the time input value. */
function timeValue(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Date + time picker (shadcn Calendar in a Popover + a time input), replacing the native
 * datetime-local control. Value is a Date; the caller serialises to ISO. Selecting a day keeps the
 * chosen time (defaulting to 09:00 on first pick); the time input keeps the chosen day.
 */
export function DateTimePicker({
  value,
  onChange,
  disabled,
}: {
  value: Date | undefined;
  onChange: (next: Date | undefined) => void;
  /** Days to disable in the calendar (e.g. past dates). */
  disabled?: (date: Date) => boolean;
}) {
  const [open, setOpen] = useState(false);

  function handleDay(day: Date | undefined) {
    if (!day) {
      onChange(undefined);
      return;
    }
    const next = new Date(day);
    if (value) next.setHours(value.getHours(), value.getMinutes(), 0, 0);
    else next.setHours(9, 0, 0, 0);
    onChange(next);
    setOpen(false);
  }

  function handleTime(next: string) {
    const [h, m] = next.split(":").map(Number);
    const base = value ? new Date(value) : new Date();
    base.setHours(h || 0, m || 0, 0, 0);
    onChange(base);
  }

  // The date trigger keeps a readable floor (min-w-32) and the time input a fixed width, so neither
  // starves the other. Without the floor the button collapsed to just its icon; without min-w-0 on
  // the row, grid children (min-width:auto) forced the whole dialog to scroll sideways.
  return (
    <div className="flex min-w-0 gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            data-empty={!value}
            className="min-w-32 flex-1 justify-start overflow-hidden text-left font-normal data-[empty=true]:text-muted-foreground"
          >
            <CalendarIcon />
            <span className="truncate">
              {value ? longDate(value) : "Pick a date"}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value}
            onSelect={handleDay}
            disabled={disabled}
            autoFocus
          />
        </PopoverContent>
      </Popover>
      <TimePicker
        className="w-28 shrink-0"
        aria-label="Time"
        value={value ? timeValue(value) : ""}
        onChange={handleTime}
      />
    </div>
  );
}
