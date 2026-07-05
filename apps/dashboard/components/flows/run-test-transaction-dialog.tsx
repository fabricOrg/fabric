"use client";

import { Button } from "@app/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@app/ui/components/ui/dialog";
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
import { ArrowRight, FlaskConical, ShieldCheck } from "lucide-react";
import { useState } from "react";
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

/**
 * Dev/QA affordance — run ONE verify→charge→notify by hand to see the reconciled record. In
 * production this flow fires from the API (checkout/login), not a form; this is a sandbox "try it".
 */
export function RunTestTransactionDialog({
  onCreated,
}: {
  onCreated: (record: TransactionRecord) => void;
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"form" | "otp">("form");
  const [msisdn, setMsisdn] = useState("");
  const [amount, setAmount] = useState("");
  const [channel, setChannel] = useState("sms");
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState<StartResponse | null>(null);
  const [code, setCode] = useState("");

  const minor = parseMinor(amount);
  const msisdnValid = E164.test(msisdn.trim());
  const canStart = msisdnValid && minor !== null && !busy;

  function reset() {
    setPhase("form");
    setStarted(null);
    setCode("");
    setMsisdn("");
    setAmount("");
    setChannel("sms");
  }

  async function start() {
    if (!canStart || minor === null) return;
    setBusy(true);
    try {
      setStarted(
        await startFlow({
          msisdn: msisdn.trim(),
          currency: CURRENCY,
          minor,
          channel,
        }),
      );
      setPhase("otp");
    } catch (e) {
      toastApiError(e);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!started || code.trim().length === 0 || minor === null || busy) return;
    setBusy(true);
    try {
      const record = await confirmFlow({
        correlationId: started.correlationId,
        code: code.trim(),
        msisdn: msisdn.trim(),
        currency: CURRENCY,
        minor,
        channel,
      });
      onCreated(record);
      setOpen(false);
      setTimeout(reset, 150);
    } catch (e) {
      toastApiError(e);
    } finally {
      setBusy(false);
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
        <Button variant="outline" size="sm">
          <FlaskConical data-icon="inline-start" />
          Run test transaction
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {phase === "otp" ? "Verify the customer" : "Test transaction"}
          </DialogTitle>
          <DialogDescription>
            {phase === "otp"
              ? "Enter the OTP to authorize the charge."
              : "Verify → collect payment → confirm, under one correlation id. Sandbox."}
          </DialogDescription>
        </DialogHeader>

        {phase === "form" ? (
          <div className="flex flex-col gap-4 py-2">
            <Field
              data-invalid={(msisdn.length > 0 && !msisdnValid) || undefined}
            >
              <FieldLabel htmlFor="t-msisdn">Customer phone</FieldLabel>
              <Input
                id="t-msisdn"
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
                <FieldLabel htmlFor="t-amount">Amount (GHS)</FieldLabel>
                <Input
                  id="t-amount"
                  inputMode="decimal"
                  placeholder="50.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="font-mono tabular-nums"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="t-channel">Notify via</FieldLabel>
                <Select value={channel} onValueChange={setChannel}>
                  <SelectTrigger id="t-channel" className="uppercase">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sms">SMS</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Button className="self-start" onClick={start} disabled={!canStart}>
              {busy ? "Sending OTP…" : "Start"}
              <ArrowRight data-icon="inline-end" />
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-2">
            <p className="text-sm text-muted-foreground">
              Code sent to{" "}
              <span className="font-mono text-foreground">
                {started?.otpSentTo}
              </span>
              . Demo code: <span className="font-mono">123456</span>.
            </p>
            <Field>
              <FieldLabel htmlFor="t-code">Verification code</FieldLabel>
              <Input
                id="t-code"
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
                Authorizes a balanced double-entry charge, then the
                confirmation.
              </FieldDescription>
            </Field>
            <Button
              className="self-start"
              onClick={confirm}
              disabled={code.trim().length === 0 || busy}
            >
              <ShieldCheck data-icon="inline-start" />
              {busy ? "Running…" : "Verify & run"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
