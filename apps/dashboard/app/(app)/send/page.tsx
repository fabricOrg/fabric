"use client";

import {
  type Currency,
  type DeliveryMode,
  parseApiError,
  toMoney,
} from "@app/contracts";
import { DEFAULT_RATES, encodeAndSegment, rateSegments } from "@app/domain";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@app/ui/components/ui/alert";
import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@app/ui/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { Separator } from "@app/ui/components/ui/separator";
import { Textarea } from "@app/ui/components/ui/textarea";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { PreflightChecks } from "@/components/send/preflight-checks";
import { RecipientReportView } from "@/components/send/recipient-report";
import {
  PersonalizeFields,
  TemplateBar,
} from "@/components/send/template-tools";
import { ViewAsApiDialog } from "@/components/send/view-as-api-dialog";
import { getConsent, type OptOut } from "@/lib/client/consent-api";
import {
  getMessagingSettings,
  getWallet,
  sendSms,
} from "@/lib/client/dashboard-api";
import { listSenders, type SenderId } from "@/lib/client/senders-api";
import { toastApiError } from "@/lib/error-toast";
import { formatMoney } from "@/lib/money";
import {
  buildPreflight,
  buildRecipientReport,
  extractTokens,
  renderTemplate,
} from "@/lib/send/preflight";

const CURRENCY: Currency = "GHS";

export default function SendPage() {
  const [to, setTo] = useState("");
  const [senderId, setSenderId] = useState("Fabric");
  const [body, setBody] = useState("");
  const [tokenValues, setTokenValues] = useState<Record<string, string>>({});

  const [balanceMinor, setBalanceMinor] = useState<bigint | null>(null);
  const [senders, setSenders] = useState<SenderId[]>([]);
  const [optOuts, setOptOuts] = useState<OptOut[]>([]);
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode | null>(null);

  const [sending, setSending] = useState(false);
  const [sentTotal, setSentTotal] = useState<string | null>(null);
  const [sentCount, setSentCount] = useState(0);
  const [sentMessageIds, setSentMessageIds] = useState<string[]>([]);
  const [blockedReqId, setBlockedReqId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getWallet()
      .then((balances) => {
        if (!live) return;
        const ghs = balances.find((b) => b.balance.currency === CURRENCY);
        setBalanceMinor(ghs ? BigInt(ghs.balance.minor) : 0n);
      })
      .catch((envelope) => live && toastApiError(envelope));
    // Sender IDs + opt-outs power the preflight; failure degrades gracefully (empty → warnings only).
    listSenders()
      .then((s) => live && setSenders(s))
      .catch(() => {});
    getConsent()
      .then((c) => live && setOptOuts(c.optOuts))
      .catch(() => {});
    getMessagingSettings()
      .then((settings) => live && setDeliveryMode(settings.delivery_mode))
      .catch((envelope) => live && toastApiError(envelope));
    return () => {
      live = false;
    };
  }, []);

  const senderOptions = useMemo(() => {
    const names = new Set(senders.map((s) => s.senderId));
    names.add("Fabric");
    return [...names];
  }, [senders]);

  const tokens = useMemo(() => extractTokens(body), [body]);
  const previewBody = useMemo(
    () => (tokens.length > 0 ? renderTemplate(body, tokenValues) : body),
    [body, tokens, tokenValues],
  );

  const report = useMemo(
    () => buildRecipientReport(to, optOuts),
    [to, optOuts],
  );
  const recipients = report.sendable.length;
  const seg = useMemo(() => encodeAndSegment(previewBody), [previewBody]);

  const checks = useMemo(
    () =>
      buildPreflight({
        report,
        body: previewBody,
        encoding: seg.encoding,
        segments: seg.segments,
        senderId,
        senders,
      }),
    [report, previewBody, seg, senderId, senders],
  );
  const hasBlock = checks.some((c) => c.level === "block");

  const perMessageMinor =
    previewBody.trim().length > 0
      ? rateSegments(seg.segments, CURRENCY, DEFAULT_RATES)
      : 0n;
  const totalMinor = perMessageMinor * BigInt(recipients);
  const ratePerSegMinor = rateSegments(1, CURRENCY, DEFAULT_RATES);
  const balanceAfterMinor =
    balanceMinor === null ? null : balanceMinor - totalMinor;
  const insufficient = balanceAfterMinor !== null && balanceAfterMinor < 0n;

  const hasEstimate = recipients > 0 && previewBody.trim().length > 0;
  const canSend =
    hasEstimate &&
    senderId.length > 0 &&
    !sending &&
    !insufficient &&
    !hasBlock &&
    balanceMinor !== null;

  async function submit() {
    setSending(true);
    setBlockedReqId(null);
    try {
      const results = [];
      for (const recipient of report.sendable) {
        const result = await sendSms({
          to: recipient,
          senderId,
          body: previewBody,
          // Console sends are transactional-style tests; campaign/promo tooling declares its own class.
          class: "transactional",
        });
        results.push(result);
      }
      setSentTotal(formatMoney(toMoney(totalMinor, CURRENCY)));
      setSentCount(results.length);
      setSentMessageIds(results.map((result) => result.id));
    } catch (envelope) {
      const parsed = parseApiError(envelope);
      if (parsed.type === "insufficient_funds_error") {
        setBlockedReqId(parsed.requestId ?? "");
      } else {
        toastApiError(envelope);
      }
    } finally {
      setSending(false);
    }
  }

  if (sentTotal !== null) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-6 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-success/15 text-success">
          <CheckCircle2 className="size-7" aria-hidden />
        </span>
        <div className="flex flex-col gap-2">
          <h2 className="font-display text-xl font-semibold tracking-tight">
            Message sent
          </h2>
          <p className="text-sm text-muted-foreground">
            Charged <span className="font-mono tabular-nums">{sentTotal}</span>{" "}
            to {sentCount} recipient{sentCount === 1 ? "" : "s"}.{" "}
            {deliveryMode === "virtual"
              ? "Delivered to your virtual phone."
              : "Track carrier delivery in Messages."}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            onClick={() => {
              setSentTotal(null);
              setTo("");
              setBody("");
              setTokenValues({});
            }}
          >
            Send another
          </Button>
          <Button variant="outline" asChild>
            <Link
              href={
                deliveryMode === "virtual"
                  ? "/virtual-phone"
                  : sentMessageIds.length === 1
                    ? `/messages?messageId=${encodeURIComponent(sentMessageIds[0] ?? "")}`
                    : "/messages"
              }
            >
              {deliveryMode === "virtual"
                ? "Open virtual phone"
                : sentMessageIds.length === 1
                  ? "View delivery record"
                  : "View messages"}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Send SMS
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          One message to one or many recipients. We validate the list, skip
          opt-outs, and show the exact cost — before you send.
        </p>
      </div>

      {blockedReqId !== null ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Insufficient balance</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>Top up your wallet to send this message.</span>
            {blockedReqId ? (
              <span className="flex items-center gap-2 text-xs">
                Support ref:
                <code className="rounded bg-background/50 px-1 py-0.5 font-mono">
                  {blockedReqId}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigator.clipboard?.writeText(blockedReqId)}
                >
                  Copy
                </Button>
              </span>
            ) : null}
            <Button size="sm" className="self-start" asChild>
              <Link href="/wallet">Top up</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        {/* Composer */}
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <Field data-invalid={report.invalid > 0 || undefined}>
              <FieldLabel htmlFor="to">To</FieldLabel>
              <Textarea
                id="to"
                rows={2}
                inputMode="tel"
                placeholder="+233201234567, +234803…"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                aria-invalid={report.invalid > 0 || undefined}
              />
              {report.invalid > 0 ? (
                <FieldError>
                  {report.invalid} entr
                  {report.invalid === 1 ? "y is" : "ies are"} not valid E.164 —
                  comma-separate numbers like +233201234567.
                </FieldError>
              ) : (
                <FieldDescription>
                  {recipients} sendable recipient{recipients === 1 ? "" : "s"} ·
                  comma- or newline-separated E.164.
                </FieldDescription>
              )}
            </Field>

            <Field>
              <FieldLabel htmlFor="sender">From (Sender ID)</FieldLabel>
              <Select value={senderId} onValueChange={setSenderId}>
                <SelectTrigger id="sender">
                  <SelectValue placeholder="Choose a sender ID" />
                </SelectTrigger>
                <SelectContent>
                  {senderOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel htmlFor="body">Message</FieldLabel>
                <TemplateBar body={body} onApply={setBody} />
              </div>
              <Textarea
                id="body"
                rows={5}
                placeholder="Type your message… use {{name}} for personalization."
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
              {body.length > 0 ? (
                <FieldDescription className="tabular-nums">
                  {seg.encoding === "gsm7" ? "GSM-7" : "UCS-2"} · {seg.length}{" "}
                  chars · {seg.segments} segment{seg.segments === 1 ? "" : "s"}
                </FieldDescription>
              ) : null}
            </Field>

            <PersonalizeFields
              tokens={tokens}
              values={tokenValues}
              onChange={setTokenValues}
              body={body}
            />
          </CardContent>
        </Card>

        {/* Live intelligence sidebar */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recipients</CardTitle>
            </CardHeader>
            <CardContent>
              {report.raw > 0 ? (
                <RecipientReportView report={report} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Add recipients to see validation, dedupe, and DND filtering.
                </p>
              )}
            </CardContent>
          </Card>

          {checks.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Preflight</CardTitle>
                <CardDescription>
                  Caught before you spend — cost, delivery, compliance.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PreflightChecks checks={checks} />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Review & send</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5 text-sm">
              {hasEstimate ? (
                <>
                  <ConfirmRow label="From" value={senderId || "—"} />
                  <ConfirmRow
                    label="Delivery"
                    value={
                      deliveryMode === "virtual"
                        ? "Virtual phone"
                        : deliveryMode === "live"
                          ? "Live carrier"
                          : "Loading..."
                    }
                  />
                  <ConfirmRow
                    label="Recipients"
                    value={<span className="tabular-nums">{recipients}</span>}
                  />
                  <ConfirmRow
                    label="Segments / message"
                    value={<span className="tabular-nums">{seg.segments}</span>}
                  />
                  <ConfirmRow
                    label="Rate / segment"
                    value={
                      <span className="font-mono tabular-nums">
                        {formatMoney(toMoney(ratePerSegMinor, CURRENCY))}
                      </span>
                    }
                  />
                  <Separator className="my-1" />
                  <ConfirmRow
                    label="Total charge"
                    value={
                      <span className="font-mono text-base font-semibold tabular-nums">
                        {formatMoney(toMoney(totalMinor, CURRENCY))}
                      </span>
                    }
                  />
                  <ConfirmRow
                    label="Balance after"
                    value={
                      <span
                        className={`font-mono tabular-nums ${insufficient ? "text-destructive" : ""}`}
                      >
                        {balanceAfterMinor === null
                          ? "—"
                          : formatMoney(toMoney(balanceAfterMinor, CURRENCY))}
                      </span>
                    }
                  />
                </>
              ) : (
                <p className="text-muted-foreground">
                  Add recipients and a message to see the cost.
                </p>
              )}
            </CardContent>
            <CardFooter className="flex-col items-stretch gap-2">
              <Button onClick={submit} loading={sending} disabled={!canSend}>
                {recipients > 1 ? `Send to ${recipients}` : "Send"}
              </Button>
              {insufficient ? (
                <span className="text-center text-xs text-destructive">
                  Not enough balance — top up your wallet.
                </span>
              ) : null}
              <ViewAsApiDialog
                to={report.sendable}
                from={senderId}
                body={previewBody}
              />
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ConfirmRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      {value}
    </div>
  );
}
