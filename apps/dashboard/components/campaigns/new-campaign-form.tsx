"use client";

import { toMoney } from "@app/contracts";
import { DEFAULT_RATES, encodeAndSegment, rateSegments } from "@app/domain";
import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { DateTimePicker } from "@app/ui/components/ui/date-time-picker";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@app/ui/components/ui/field";
import { Input } from "@app/ui/components/ui/input";
import { Separator } from "@app/ui/components/ui/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@app/ui/components/ui/tabs";
import { Textarea } from "@app/ui/components/ui/textarea";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { createCampaign } from "@/lib/client/campaigns-api";
import { toastApiError } from "@/lib/error-toast";
import { formatMoney } from "@/lib/money";

const CURRENCY = "GHS" as const;

type Schedule = "now" | "later";

/** Midnight today — the calendar disables anything before it (can't schedule in the past). */
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Create-campaign form — two columns: details on the left, a sticky review/send summary on the right.
 * Money is exact bigint minor units: cost = ratePerSegment × segments(body) × audienceSize, never a
 * float. On success we route back to the list (which re-fetches); failures keep the form filled.
 */
export function NewCampaignForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("");
  const [schedule, setSchedule] = useState<Schedule>("now");
  const [scheduledAt, setScheduledAt] = useState<Date | undefined>(undefined);
  const [respectOptOuts, setRespectOptOuts] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const nameId = useId();
  const bodyId = useId();
  const audienceId = useId();
  const scheduleId = useId();

  const audienceSize = Number.parseInt(audience, 10);
  const hasAudience = Number.isInteger(audienceSize) && audienceSize > 0;

  const seg = useMemo(() => encodeAndSegment(body || " "), [body]);
  const perSegmentMinor = rateSegments(1, CURRENCY, DEFAULT_RATES);
  const estimateMinor =
    body.length > 0 && hasAudience
      ? perSegmentMinor * BigInt(seg.segments) * BigInt(audienceSize)
      : 0n;
  const showEstimate = body.length > 0 && hasAudience;

  const scheduleValid = schedule === "now" || scheduledAt !== undefined;
  const canSubmit =
    name.trim().length > 0 &&
    body.trim().length > 0 &&
    hasAudience &&
    scheduleValid &&
    !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const created = await createCampaign({
        name: name.trim(),
        body: body.trim(),
        audienceSize,
        scheduledAt:
          schedule === "later" && scheduledAt
            ? scheduledAt.toISOString()
            : null,
        respectOptOuts,
      });
      toast.success(
        created.status === "scheduled"
          ? `“${created.name}” scheduled`
          : `“${created.name}” is sending`,
      );
      router.push("/campaigns");
    } catch (envelope) {
      toastApiError(envelope);
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Details — left, wider column */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Campaign details</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor={nameId}>Campaign name</FieldLabel>
            <Input
              id={nameId}
              placeholder="e.g. October flash sale"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <FieldDescription>
              Internal label — recipients never see this.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor={bodyId}>Message</FieldLabel>
            <Textarea
              id={bodyId}
              rows={5}
              placeholder="Type your message…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <FieldDescription>
              {body.length > 0 ? (
                <span className="tabular-nums">
                  {body.length} chars · {seg.segments} segment
                  {seg.segments === 1 ? "" : "s"} ·{" "}
                  {seg.encoding === "ucs2" ? "UCS-2" : "GSM-7"}
                </span>
              ) : (
                "Longer messages and non-GSM characters use more segments."
              )}
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor={audienceId}>Audience size</FieldLabel>
            <Input
              id={audienceId}
              inputMode="numeric"
              placeholder="e.g. 5000"
              value={audience}
              onChange={(e) =>
                setAudience(e.target.value.replace(/[^\d]/g, ""))
              }
              className="font-mono tabular-nums"
            />
            <FieldDescription>
              Number of recipients in the selected list.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel id={scheduleId}>Schedule</FieldLabel>
            <Tabs
              value={schedule}
              onValueChange={(v) => setSchedule(v as Schedule)}
            >
              <TabsList aria-labelledby={scheduleId}>
                <TabsTrigger value="now">Send now</TabsTrigger>
                <TabsTrigger value="later">Schedule</TabsTrigger>
              </TabsList>
              <TabsContent value="now">
                <FieldDescription>
                  Sending starts as soon as you confirm.
                </FieldDescription>
              </TabsContent>
              <TabsContent value="later">
                <DateTimePicker
                  value={scheduledAt}
                  onChange={setScheduledAt}
                  disabled={(date) => date < startOfToday()}
                />
              </TabsContent>
            </Tabs>
          </Field>

          <Field>
            <FieldLabel>Opt-out handling</FieldLabel>
            <div
              className="flex gap-2"
              role="group"
              aria-label="Opt-out handling"
            >
              <Button
                type="button"
                variant={respectOptOuts ? "default" : "outline"}
                size="sm"
                aria-pressed={respectOptOuts}
                onClick={() => setRespectOptOuts(true)}
              >
                Respect opt-outs
              </Button>
              <Button
                type="button"
                variant={respectOptOuts ? "outline" : "default"}
                size="sm"
                aria-pressed={!respectOptOuts}
                onClick={() => setRespectOptOuts(false)}
              >
                Send to all
              </Button>
            </div>
            <FieldDescription>
              {respectOptOuts
                ? "Promotional default: recipients who opted out are suppressed and never messaged."
                : "Transactional only: send to everyone. Use only for service messages the law exempts from opt-out."}
            </FieldDescription>
          </Field>
        </CardContent>
      </Card>

      {/* Review & send — right column, sticky. The spend consequence + the send action. */}
      <div className="lg:col-span-1">
        <Card className="lg:sticky lg:top-6">
          <CardHeader>
            <CardTitle className="text-base">Review &amp; send</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">
                Estimated cost
              </span>
              <span className="font-display text-3xl font-semibold tabular-nums">
                {showEstimate
                  ? formatMoney(toMoney(estimateMinor, CURRENCY))
                  : "—"}
              </span>
              {showEstimate && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatMoney(toMoney(perSegmentMinor, CURRENCY))} ×{" "}
                  {seg.segments} segment{seg.segments === 1 ? "" : "s"} ×{" "}
                  {audienceSize.toLocaleString("en")} recipients
                </span>
              )}
            </div>

            <Separator />

            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-muted-foreground">Schedule</span>
              <span className="text-right font-medium">
                {schedule === "now"
                  ? "Send now"
                  : scheduledAt
                    ? scheduledAt.toLocaleString("en", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })
                    : "Not set"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-muted-foreground">Opt-outs</span>
              <span className="font-medium">
                {respectOptOuts ? "Respected" : "Sending to all"}
              </span>
            </div>

            <Separator />

            <Button
              onClick={submit}
              loading={submitting}
              disabled={!canSubmit}
              className="w-full"
            >
              {schedule === "later" ? "Schedule campaign" : "Send campaign"}
            </Button>
            <Button variant="outline" asChild className="w-full">
              <Link href="/campaigns">Cancel</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
