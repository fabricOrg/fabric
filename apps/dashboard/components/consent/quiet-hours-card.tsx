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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { Switch } from "@app/ui/components/ui/switch";
import { TimePicker } from "@app/ui/components/ui/time-picker";
import { cn } from "@app/ui/lib/utils";
import { Clock, Moon } from "lucide-react";
import { useState } from "react";
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
        <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/20 p-3">
          <div>
            <p className="text-sm font-medium">Enforce quiet hours</p>
            <p className="text-xs text-muted-foreground">
              Hold promotional messages outside the configured window.
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-label="Enforce quiet hours"
          />
        </div>

        <div
          className={cn(
            "grid gap-4 sm:grid-cols-3",
            !enabled && "pointer-events-none opacity-50",
          )}
          aria-hidden={!enabled}
        >
          <Field>
            <FieldLabel>Start</FieldLabel>
            <TimePicker
              aria-label="Quiet hours start"
              value={start}
              disabled={!enabled}
              onChange={setStart}
              className="w-full"
            />
          </Field>
          <Field>
            <FieldLabel>End</FieldLabel>
            <TimePicker
              aria-label="Quiet hours end"
              value={end}
              disabled={!enabled}
              onChange={setEnd}
              className="w-full"
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
