"use client";

import { Button } from "@app/ui/components/ui/button";
import { Input } from "@app/ui/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@app/ui/components/ui/popover";
import { cn } from "@app/ui/lib/utils";
import { Clock } from "lucide-react";
import { useId } from "react";

function clamp(value: string, maximum: number): string {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return "00";
  return String(Math.min(maximum, Math.max(0, parsed))).padStart(2, "0");
}

/**
 * Accessible 24-hour picker composed from the shared shadcn Popover and Input primitives.
 * The controlled value is always emitted as HH:mm.
 */
export function TimePicker({
  value,
  onChange,
  disabled,
  className,
  "aria-label": ariaLabel = "Choose time",
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const [hour = "00", minute = "00"] = value.split(":");
  const id = useId();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={ariaLabel}
          className={cn(
            "w-full justify-start font-mono font-normal tabular-nums",
            className,
          )}
        >
          <Clock data-icon="inline-start" />
          {hour}:{minute}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <div className="mb-3">
          <p className="text-sm font-medium">{ariaLabel}</p>
          <p className="text-xs text-muted-foreground">24-hour time</p>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
          <div className="grid gap-1.5">
            <label
              htmlFor={`${id}-hour`}
              className="text-xs font-medium text-muted-foreground"
            >
              Hour
            </label>
            <Input
              id={`${id}-hour`}
              type="number"
              inputMode="numeric"
              min={0}
              max={23}
              value={Number(hour)}
              onChange={(event) =>
                onChange(`${clamp(event.target.value, 23)}:${minute}`)
              }
              className="text-center font-mono tabular-nums"
              aria-label={`${ariaLabel} hour, 0 to 23`}
            />
          </div>
          <span className="pb-2 text-muted-foreground" aria-hidden="true">
            :
          </span>
          <div className="grid gap-1.5">
            <label
              htmlFor={`${id}-minute`}
              className="text-xs font-medium text-muted-foreground"
            >
              Minute
            </label>
            <Input
              id={`${id}-minute`}
              type="number"
              inputMode="numeric"
              min={0}
              max={59}
              value={Number(minute)}
              onChange={(event) =>
                onChange(`${hour}:${clamp(event.target.value, 59)}`)
              }
              className="text-center font-mono tabular-nums"
              aria-label={`${ariaLabel} minute, 0 to 59`}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
