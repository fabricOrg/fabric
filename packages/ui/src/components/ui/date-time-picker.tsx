"use client";

import { Button } from "@app/ui/components/ui/button";
import { Calendar } from "@app/ui/components/ui/calendar";
import { Input } from "@app/ui/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@app/ui/components/ui/popover";
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

  function handleTime(event: React.ChangeEvent<HTMLInputElement>) {
    const [h, m] = event.target.value.split(":").map(Number);
    const base = value ? new Date(value) : new Date();
    base.setHours(h || 0, m || 0, 0, 0);
    onChange(base);
  }

  return (
    <div className="flex gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            data-empty={!value}
            className="flex-1 justify-start text-left font-normal data-[empty=true]:text-muted-foreground"
          >
            <CalendarIcon />
            {value ? longDate(value) : <span>Pick a date</span>}
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
      <Input
        type="time"
        aria-label="Time"
        value={value ? timeValue(value) : ""}
        onChange={handleTime}
        className="w-32 font-mono tabular-nums"
      />
    </div>
  );
}
