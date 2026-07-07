"use client";

import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { Field, FieldLabel } from "@app/ui/components/ui/field";
import { Input } from "@app/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { cn } from "@app/ui/lib/utils";
import { Clock, Moon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { type QuietHours, saveQuietHours } from "@/lib/client/consent-api";
import { toastApiError } from "@/lib/error-toast";

// West Africa timezones Fabric operates in; 2442 DND is a Nigeria (Africa/Lagos) requirement.
const TIMEZONES = ["Africa/Lagos", "Africa/Accra"] as const;

/**
 * Promotional quiet-hours window editor. Transactional traffic ignores this entirely (see the
 * classification card). Enabled toggle is two buttons — the design system has no Switch. Save →
 * POST → toast.
 */
export function QuietHoursCard({
  quietHours,
  onSaved,
}: {
  quietHours: QuietHours;
  onSaved: (next: QuietHours) => void;
}) {
  const [start, setStart] = useState(quietHours.start);
  const [end, setEnd] = useState(quietHours.end);
  const [timezone, setTimezone] = useState(quietHours.timezone);
  const [enabled, setEnabled] = useState(quietHours.enabled);
  const [saving, setSaving] = useState(false);
  const startId = useId();
  const endId = useId();

  const dirty =
    start !== quietHours.start ||
    end !== quietHours.end ||
    timezone !== quietHours.timezone ||
    enabled !== quietHours.enabled;

  async function save() {
    setSaving(true);
    try {
      const next = await saveQuietHours({ start, end, timezone, enabled });
      onSaved(next);
      toast.success("Quiet hours saved", {
        description: enabled
          ? `Promotional SMS pauses ${next.start}–${next.end} (${next.timezone}).`
          : "Quiet hours are off — promotional SMS can send any time.",
      });
    } catch (payload) {
      toastApiError(payload);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Moon className="size-4 text-muted-foreground" />
          Quiet hours
        </CardTitle>
        <CardDescription>
          The window when promotional SMS is held back. Outside this window
          sends resume automatically. OTP and alerts are never paused.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Status</legend>
          <div className="inline-flex w-fit rounded-lg border p-0.5">
            <Button
              type="button"
              size="sm"
              variant={enabled ? "default" : "ghost"}
              aria-pressed={enabled}
              onClick={() => setEnabled(true)}
            >
              On
            </Button>
            <Button
              type="button"
              size="sm"
              variant={enabled ? "ghost" : "default"}
              aria-pressed={!enabled}
              onClick={() => setEnabled(false)}
            >
              Off
            </Button>
          </div>
        </fieldset>

        <div
          className={cn(
            "grid gap-4 sm:grid-cols-3",
            !enabled && "pointer-events-none opacity-50",
          )}
          aria-hidden={!enabled}
        >
          <Field>
            <FieldLabel htmlFor={startId}>Start</FieldLabel>
            <Input
              id={startId}
              type="time"
              value={start}
              disabled={!enabled}
              onChange={(e) => setStart(e.target.value)}
              className="font-mono tabular-nums"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={endId}>End</FieldLabel>
            <Input
              id={endId}
              type="time"
              value={end}
              disabled={!enabled}
              onChange={(e) => setEnd(e.target.value)}
              className="font-mono tabular-nums"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="quiet-hours-tz">Timezone</FieldLabel>
            <Select
              value={timezone}
              onValueChange={setTimezone}
              disabled={!enabled}
            >
              <SelectTrigger id="quiet-hours-tz">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Badge
          variant="outline"
          className={cn(
            "w-fit gap-1 border-transparent",
            enabled
              ? "bg-primary/10 text-primary"
              : "bg-muted text-muted-foreground",
          )}
        >
          <Clock />
          {enabled
            ? `Promotional paused ${start}–${end} ${timezone}`
            : "Quiet hours off"}
        </Badge>
      </CardContent>

      <CardFooter>
        <Button onClick={save} loading={saving} disabled={!dirty}>
          Save quiet hours
        </Button>
      </CardFooter>
    </Card>
  );
}
