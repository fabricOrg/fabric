"use client";

import { Button } from "@app/ui/components/ui/button";
import { Calendar } from "@app/ui/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@app/ui/components/ui/popover";
import { cn } from "@app/ui/lib/utils";
import { CalendarIcon } from "lucide-react";
import { useState } from "react";
import type { DateRange } from "react-day-picker";

export type { DateRange };

/** "8 Jul 2026" — compact date for the range label. */
function shortDate(d: Date): string {
  return d.toLocaleDateString("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function label(range: DateRange | undefined): string {
  if (!range?.from) return "Pick a date range";
  if (!range.to) return shortDate(range.from);
  return `${shortDate(range.from)} – ${shortDate(range.to)}`;
}

/**
 * Date-range picker (shadcn Calendar `mode="range"` in a Popover) — the standard control for any
 * "from → to" filter (reports, analytics, activity windows). Controlled: pass `value` + `onChange`.
 */
export function DateRangePicker({
  value,
  onChange,
  numberOfMonths = 2,
  disabled,
  className,
}: {
  value: DateRange | undefined;
  onChange: (next: DateRange | undefined) => void;
  numberOfMonths?: number;
  disabled?: (date: Date) => boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          data-empty={!value?.from}
          className={cn(
            "justify-start text-left font-normal data-[empty=true]:text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon />
          {label(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={value}
          onSelect={onChange}
          numberOfMonths={numberOfMonths}
          disabled={disabled}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
