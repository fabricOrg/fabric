"use client";

import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@app/ui/components/ui/field";
import { Input } from "@app/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { TransactionRecordView } from "@/components/flows/transaction-record";
import {
  confirmFlow,
  type StartResponse,
  startFlow,
  type TransactionRecord,
} from "@/lib/client/flows-api";
import { toastApiError } from "@/lib/error-toast";
import { parseAmountToMinor } from "@/lib/money";

const CURRENCY = "GHS";
const E164 = /^\+[1-9]\d{7,14}$/;

function parseMinor(raw: string): string | null {
  try {
    const minor = parseAmountToMinor(raw, CURRENCY);
    return minor !== null && minor > 0n ? minor.toString() : null;
  } catch {
    return null;
  }
}

export default function FlowsPage() {
  const [phase, setPhase] = useState<"form" | "otp" | "done">("form");
  const [msisdn, setMsisdn] = useState("");
  const [amount, setAmount] = useState("");
  const [channel, setChannel] = useState("sms");
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState<StartResponse | null>(null);
  const [code, setCode] = useState("");
  const [record, setRecord] = useState<TransactionRecord | null>(null);

  const minor = parseMinor(amount);
  const msisdnValid = E164.test(msisdn.trim());
  const canStart = msisdnValid && minor !== null && !busy;

  async function start() {
    if (!canStart || minor === null) return;
    setBusy(true);
    try {
      const res = await startFlow({
        msisdn: msisdn.trim(),
        currency: CURRENCY,
        minor,
        channel,
      });
      setStarted(res);
      setPhase("otp");
    } catch (payload) {
      toastApiError(payload);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!started || code.trim().length === 0 || minor === null || busy) return;
    setBusy(true);
    try {
      const result = await confirmFlow({
        correlationId: started.correlationId,
        code: code.trim(),
        msisdn: msisdn.trim(),
        currency: CURRENCY,
        minor,
        channel,
      });
      setRecord(result);
      setPhase("done");
    } catch (payload) {
      toastApiError(payload);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setPhase("form");
    setStarted(null);
    setCode("");
    setRecord(null);
    setMsisdn("");
    setAmount("");
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Transactions
        </h1>
        <p className="text-sm text-muted-foreground">
          Verify, charge, and notify a customer as one reconciled, audited
          transaction — the thing three separate vendors can't give you.
        </p>
      </div>

      {phase === "done" && record ? (
        <>
          <TransactionRecordView record={record} />
          <Button variant="outline" className="self-start" onClick={reset}>
            Run another
          </Button>
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {phase === "otp" ? "Verify the customer" : "New transaction"}
            </CardTitle>
            <CardDescription>
              {phase === "otp"
                ? "An OTP was sent — enter it to authorize the charge."
                : "Verify → collect payment → confirm, under one correlation id."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {phase === "form" ? (
              <>
                <Field
                  data-invalid={
                    (msisdn.length > 0 && !msisdnValid) || undefined
                  }
                >
                  <FieldLabel htmlFor="msisdn">Customer phone</FieldLabel>
                  <Input
                    id="msisdn"
                    inputMode="tel"
                    placeholder="+233201234567"
                    value={msisdn}
                    onChange={(e) => setMsisdn(e.target.value)}
                    className="font-mono"
                  />
                  {msisdn.length > 0 && !msisdnValid ? (
                    <FieldError>Enter a valid E.164 number.</FieldError>
                  ) : null}
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field
                    data-invalid={
                      (amount.length > 0 && minor === null) || undefined
                    }
                  >
                    <FieldLabel htmlFor="amount">Amount (GHS)</FieldLabel>
                    <Input
                      id="amount"
                      inputMode="decimal"
                      placeholder="50.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="font-mono tabular-nums"
                    />
                    {amount.length > 0 && minor === null ? (
                      <FieldError>Enter an amount above zero.</FieldError>
                    ) : null}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="channel">Notify via</FieldLabel>
                    <Select value={channel} onValueChange={setChannel}>
                      <SelectTrigger id="channel" className="uppercase">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sms">SMS</SelectItem>
                        <SelectItem value="whatsapp">WhatsApp</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <Button
                  className="self-start"
                  onClick={start}
                  disabled={!canStart}
                >
                  {busy ? "Sending OTP…" : "Start"}
                  <ArrowRight data-icon="inline-end" />
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Code sent to{" "}
                  <span className="font-mono text-foreground">
                    {started?.otpSentTo}
                  </span>
                  . Demo code: <span className="font-mono">123456</span>.
                </p>
                <Field>
                  <FieldLabel htmlFor="code">Verification code</FieldLabel>
                  <Input
                    id="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="123456"
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    className="font-mono tracking-[0.4em] tabular-nums"
                  />
                  <FieldDescription>
                    Verifying authorizes a balanced double-entry charge, then
                    the confirmation.
                  </FieldDescription>
                </Field>
                <Button
                  className="self-start"
                  onClick={confirm}
                  disabled={code.trim().length === 0 || busy}
                >
                  <ShieldCheck data-icon="inline-start" />
                  {busy ? "Running…" : "Verify & run transaction"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
