"use client";

import { toMoney } from "@app/contracts";
import { DEFAULT_RATES, encodeAndSegment, rateSegments } from "@app/domain";
import { Button } from "@app/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@app/ui/components/ui/dialog";
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
import { Megaphone } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { type Campaign, createCampaign } from "@/lib/client/campaigns-api";
import { toastApiError } from "@/lib/error-toast";
import { formatMoney } from "@/lib/money";

const CURRENCY = "GHS" as const;

type Schedule = "now" | "later";

/**
 * Create-campaign flow (mock BFF). Money is exact bigint minor units end-to-end:
 * cost = ratePerSegment × segments(body) × audienceSize — never a float. On success the parent
 * prepends the returned campaign optimistically; failures route through toastApiError.
 */
export function NewCampaignDialog({
  onCreated,
}: {
  onCreated: (campaign: Campaign) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("");
  const [schedule, setSchedule] = useState<Schedule>("now");
  const [scheduledAt, setScheduledAt] = useState("");
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

  const scheduleValid = schedule === "now" || scheduledAt.length > 0;
  const canSubmit =
    name.trim().length > 0 &&
    body.trim().length > 0 &&
    hasAudience &&
    scheduleValid &&
    !submitting;

  function reset() {
    setName("");
    setBody("");
    setAudience("");
    setSchedule("now");
    setScheduledAt("");
    setRespectOptOuts(true);
    setSubmitting(false);
  }

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
            ? new Date(scheduledAt).toISOString()
            : null,
        respectOptOuts,
      });
      onCreated(created);
      setOpen(false);
      setTimeout(reset, 150);
    } catch (envelope) {
      toastApiError(envelope);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setTimeout(reset, 150);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Megaphone data-icon="inline-start" />
          New campaign
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">New campaign</DialogTitle>
          <DialogDescription>
            Send one message to a whole audience. The cost is exact and shown
            before you confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
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
              rows={4}
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
                <Input
                  type="datetime-local"
                  aria-label="Scheduled date and time"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="font-mono"
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

          <Separator />

          {/* Exact estimate (bigint minor) shown before confirm — the spend consequence, made legible. */}
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-muted-foreground">Estimated cost</span>
            <span className="font-mono tabular-nums font-semibold">
              {body.length > 0 && hasAudience
                ? formatMoney(toMoney(estimateMinor, CURRENCY))
                : "—"}
            </span>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={submit} disabled={!canSubmit}>
            {submitting
              ? "Creating…"
              : schedule === "later"
                ? "Schedule campaign"
                : "Send campaign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
