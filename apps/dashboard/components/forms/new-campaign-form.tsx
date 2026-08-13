"use client";

import { toMoney } from "@app/contracts";
import { encodeAndSegment } from "@app/domain";
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
import { useForm, useStore } from "@tanstack/react-form";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { createCampaign } from "@/lib/client/campaigns-api";
import { toastApiError } from "@/lib/error-toast";
import { formatMoney } from "@/lib/money";
import {
  CURRENCY,
  estimate,
  type Schedule,
  schema,
  startOfToday,
} from "./new-campaign-form.schema";

/**
 * Create-campaign form. Validated inputs (name/message/audience) live in a single TanStack Form; the
 * schedule tabs, date picker, and opt-out toggle stay local state as they drive the live summary.
 */
export function NewCampaignForm() {
  const router = useRouter();
  const [schedule, setSchedule] = useState<Schedule>("now");
  const [scheduledAt, setScheduledAt] = useState<Date | undefined>(undefined);
  const respectOptOuts = true;
  const scheduleId = useId();

  const scheduleValid = schedule === "now" || scheduledAt !== undefined;

  const form = useForm({
    defaultValues: { name: "", body: "", audience: "" },
    validators: { onMount: schema, onChange: schema },
    onSubmit: async ({ value }) => {
      if (!scheduleValid) return;
      try {
        const created = await createCampaign({
          name: value.name.trim(),
          body: value.body.trim(),
          audienceSize: Number.parseInt(value.audience, 10),
          scheduledAt:
            schedule === "later" && scheduledAt
              ? scheduledAt.toISOString()
              : null,
          respectOptOuts,
        });
        toast.success(`“${created.name}” preview created`, {
          description:
            created.status === "scheduled"
              ? "The preview schedule was saved. No production audience was contacted."
              : "No production audience was contacted.",
        });
        router.push("/campaigns");
      } catch (envelope) {
        toastApiError(envelope);
      }
    },
  });

  // Reactive reads for the live summary + submit gating (same whole-form re-render the old useState had).
  const body = useStore(form.store, (s) => s.values.body);
  const audience = useStore(form.store, (s) => s.values.audience);
  const canSubmit = useStore(form.store, (s) => s.canSubmit);
  const isSubmitting = useStore(form.store, (s) => s.isSubmitting);
  const { seg, perSegmentMinor, show, estimateMinor, audienceSize } = estimate(
    body,
    audience,
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
      className="grid gap-6 lg:grid-cols-3"
    >
      {/* Details — left, wider column */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Campaign details</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form.Field name="name">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Campaign name</FieldLabel>
                <Input
                  id={field.name}
                  placeholder="e.g. October flash sale"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="body">
            {(field) => {
              const seg = encodeAndSegment(field.state.value || " ");
              return (
                <Field>
                  <FieldLabel htmlFor={field.name}>Message</FieldLabel>
                  <Textarea
                    id={field.name}
                    rows={5}
                    placeholder="Type your message…"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                  />
                  {field.state.value.length > 0 ? (
                    <FieldDescription>
                      <span className="tabular-nums">
                        {field.state.value.length} chars · {seg.segments}{" "}
                        segment
                        {seg.segments === 1 ? "" : "s"} ·{" "}
                        {seg.encoding === "ucs2" ? "UCS-2" : "GSM-7"}
                      </span>
                    </FieldDescription>
                  ) : null}
                </Field>
              );
            }}
          </form.Field>
          <form.Field name="audience">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Audience size</FieldLabel>
                <Input
                  id={field.name}
                  inputMode="numeric"
                  placeholder="e.g. 5000"
                  value={field.state.value}
                  onChange={(e) =>
                    field.handleChange(e.target.value.replace(/[^\d]/g, ""))
                  }
                  onBlur={field.handleBlur}
                  className="font-mono tabular-nums"
                />
              </Field>
            )}
          </form.Field>
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
              <TabsContent value="now" />
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
            <FieldLabel>Compliance policy</FieldLabel>
            <div className="rounded-md border bg-muted/25 p-3 text-sm">
              Promotional opt-outs are always suppressed in Campaigns. A bulk
              campaign cannot override recipient consent.
            </div>
          </Field>
        </CardContent>
      </Card>

      {/* Review & send — right column, sticky. The spend consequence + the send action. */}
      <div className="lg:col-span-1">
        <Card className="lg:sticky lg:top-6">
          <CardHeader>
            <CardTitle className="text-base">Review preview</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">
                Estimated cost
              </span>
              <span className="font-display text-3xl font-semibold tabular-nums">
                {show ? formatMoney(toMoney(estimateMinor, CURRENCY)) : "—"}
              </span>
              {show && (
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
              <span className="font-medium">Always respected</span>
            </div>

            <Separator />

            <Button
              type="submit"
              loading={isSubmitting}
              disabled={!canSubmit || !scheduleValid}
              className="w-full"
            >
              {schedule === "later"
                ? "Create scheduled preview"
                : "Create campaign preview"}
            </Button>
            <Button variant="outline" asChild className="w-full">
              <Link href="/campaigns">Cancel</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </form>
  );
}
