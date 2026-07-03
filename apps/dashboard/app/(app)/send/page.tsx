"use client";

import { type Currency, parseApiError, toMoney } from "@app/contracts";
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
import Link from "next/link";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { CostEstimatePanel } from "@/components/cost-estimate-panel";
import { toastApiError } from "@/lib/error-toast";
import { SENDER_IDS } from "@/lib/fixtures";
import { getWallet, sendSms } from "@/lib/mock-api";
import { formatMoney } from "@/lib/money";

const CURRENCY: Currency = "GHS";
const E164 = /^\+[1-9]\d{7,14}$/;

function parseRecipients(raw: string): { valid: string[]; invalid: number } {
  const parts = raw
    .split(/[,\n]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const valid = parts.filter((p) => E164.test(p));
  return { valid, invalid: parts.length - valid.length };
}

export default function SendPage() {
  const [to, setTo] = useState("");
  const [senderId, setSenderId] = useState(SENDER_IDS[0] ?? "");
  const [body, setBody] = useState("");
  const [balanceMinor, setBalanceMinor] = useState<bigint | null>(null);
  const [sending, setSending] = useState(false);
  const [sentTotal, setSentTotal] = useState<string | null>(null);
  const [sentCount, setSentCount] = useState(0);
  const [blockedReqId, setBlockedReqId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getWallet()
      .then((balances) => {
        if (!live) return;
        const ghs = balances.find((b) => b.balance.currency === CURRENCY);
        setBalanceMinor(ghs ? BigInt(ghs.balance.minor) : 0n);
      })
      .catch((envelope) => {
        if (live) toastApiError(envelope);
      });
    return () => {
      live = false;
    };
  }, []);

  const { valid, invalid } = useMemo(() => parseRecipients(to), [to]);
  const recipients = valid.length;
  const seg = useMemo(() => encodeAndSegment(body), [body]);

  const perMessageMinor =
    body.length > 0 ? rateSegments(seg.segments, CURRENCY, DEFAULT_RATES) : 0n;
  const totalMinor = perMessageMinor * BigInt(recipients);
  const ratePerSegMinor = rateSegments(1, CURRENCY, DEFAULT_RATES);
  const balanceAfterMinor =
    balanceMinor === null ? null : balanceMinor - totalMinor;
  const insufficient = balanceAfterMinor !== null && balanceAfterMinor < 0n;

  const hasEstimate = recipients > 0 && body.length > 0;
  const canSend =
    hasEstimate && senderId.length > 0 && !sending && balanceMinor !== null;

  async function submit() {
    setSending(true);
    setBlockedReqId(null);
    try {
      const scenario = insufficient ? "insufficient" : "ok";
      await sendSms({ to: valid.join(","), senderId, body }, scenario);
      setSentTotal(formatMoney(toMoney(totalMinor, CURRENCY)));
      setSentCount(recipients);
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
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="font-display">Message sent</CardTitle>
            <CardDescription>
              Charged{" "}
              <span className="font-mono tabular-nums">{sentTotal}</span> to{" "}
              {sentCount} recipient{sentCount === 1 ? "" : "s"}. Track delivery
              in the log.
            </CardDescription>
          </CardHeader>
          <CardFooter className="gap-2">
            <Button
              onClick={() => {
                setSentTotal(null);
                setTo("");
                setBody("");
              }}
            >
              Send another
            </Button>
            <Button variant="outline" asChild>
              <Link href="/">Back to overview</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Send SMS
        </h1>
        <p className="text-sm text-muted-foreground">
          One message to one or many recipients. Cost is exact and shown before
          you send.
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

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <Field data-invalid={invalid > 0 || undefined}>
            <FieldLabel htmlFor="to">To</FieldLabel>
            <Textarea
              id="to"
              rows={2}
              inputMode="tel"
              placeholder="+233201234567, +234803…"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-invalid={invalid > 0 || undefined}
            />
            {invalid > 0 ? (
              <FieldError>
                {invalid} entr{invalid === 1 ? "y is" : "ies are"} not valid
                E.164 — comma-separate numbers like +233201234567.
              </FieldError>
            ) : (
              <FieldDescription>
                {recipients} recipient{recipients === 1 ? "" : "s"} ·
                comma-separated E.164.
              </FieldDescription>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor="sender">From (Sender ID)</FieldLabel>
            <Select value={senderId} onValueChange={setSenderId}>
              <SelectTrigger id="sender">
                <SelectValue placeholder="Choose a provisioned sender ID" />
              </SelectTrigger>
              <SelectContent>
                {SENDER_IDS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="body">Message</FieldLabel>
            <Textarea
              id="body"
              rows={5}
              placeholder="Type your message…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
        </CardContent>
      </Card>

      {hasEstimate ? (
        <CostEstimatePanel
          recipients={recipients}
          encoding={seg.encoding}
          segmentsPerMessage={seg.segments}
          ratePerSegmentLabel={formatMoney(toMoney(ratePerSegMinor, CURRENCY))}
          estimatedTotalLabel={formatMoney(toMoney(totalMinor, CURRENCY))}
          balanceAfterLabel={
            balanceAfterMinor === null
              ? null
              : formatMoney(toMoney(balanceAfterMinor, CURRENCY))
          }
          insufficient={insufficient}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Confirm before sending</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5 text-sm">
          <ConfirmRow label="From" value={senderId || "—"} />
          <ConfirmRow
            label="Segments / message"
            value={
              <span className="tabular-nums">
                {hasEstimate ? seg.segments : "—"}
              </span>
            }
          />
          <Separator className="my-1" />
          <ConfirmRow
            label="Total charge"
            value={
              <span className="font-mono tabular-nums font-semibold">
                {hasEstimate ? formatMoney(toMoney(totalMinor, CURRENCY)) : "—"}
              </span>
            }
          />
        </CardContent>
        <CardFooter>
          <Button onClick={submit} disabled={!canSend}>
            {sending ? "Sending…" : "Send"}
          </Button>
        </CardFooter>
      </Card>
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
