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
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@app/ui/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { cn } from "@app/ui/lib/utils";
import { CheckCircle2, KeyRound, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import {
  checkVerification,
  DEMO_OK_CODE,
  startVerification,
  type Verification,
  type VerifyChannel,
  type VerifyChannelName,
} from "@/lib/client/verify-api";
import { toastApiError } from "@/lib/error-toast";

const E164 = /^\+[1-9]\d{7,14}$/;
const CHANNEL_LABEL: Record<VerifyChannelName, string> = {
  sms: "SMS",
  voice: "Voice",
  whatsapp: "WhatsApp",
  email: "Email",
};

type Step = "input" | "code" | "done";

export function TestVerificationCard({
  channels,
  onStarted,
  onResolved,
}: {
  channels: readonly VerifyChannel[];
  onStarted?: (v: Verification) => void;
  onResolved?: (v: Verification) => void;
}) {
  const options = useMemo(
    () =>
      channels
        .filter((c) => c.enabled)
        .sort((a, b) => a.order - b.order)
        .map((c) => c.channel),
    [channels],
  );

  const [step, setStep] = useState<Step>("input");
  const [msisdn, setMsisdn] = useState("");
  const [channel, setChannel] = useState<VerifyChannelName | "">("");
  const [pending, setPending] = useState<Verification | null>(null);
  const [code, setCode] = useState("");
  const [outcome, setOutcome] = useState<Verification | null>(null);
  const [busy, setBusy] = useState(false);

  const validMsisdn = E164.test(msisdn.trim());
  const chosen = channel || options[0];
  const canSend = validMsisdn && Boolean(chosen) && !busy;

  function reset() {
    setStep("input");
    setPending(null);
    setCode("");
    setOutcome(null);
  }

  async function send() {
    if (!canSend || !chosen) return;
    setBusy(true);
    try {
      const started = await startVerification({
        msisdn: msisdn.trim(),
        channel: chosen,
      });
      setPending(started);
      onStarted?.(started);
      setStep("code");
    } catch (payload) {
      toastApiError(payload);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!pending || code.trim().length === 0 || busy) return;
    setBusy(true);
    try {
      const checked = await checkVerification({
        id: pending.id,
        code: code.trim(),
      });
      // The BFF check only knows the code — re-attach the destination it was sent to.
      const merged: Verification = {
        ...checked,
        msisdn: pending.msisdn,
        channel: pending.channel,
        createdAt: pending.createdAt,
      };
      setOutcome(merged);
      onResolved?.(merged);
      setStep("done");
    } catch (payload) {
      toastApiError(payload);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="font-display">Test a verification</CardTitle>
        <CardDescription>
          Send yourself a live OTP end-to-end — no code changes, no wallet
          charge.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        {step === "input" ? (
          <>
            <Field
              data-invalid={(msisdn.length > 0 && !validMsisdn) || undefined}
            >
              <FieldLabel htmlFor="test-msisdn">Phone number</FieldLabel>
              <Input
                id="test-msisdn"
                inputMode="tel"
                placeholder="+233201234567"
                value={msisdn}
                onChange={(e) => setMsisdn(e.target.value)}
                aria-invalid={(msisdn.length > 0 && !validMsisdn) || undefined}
              />
              {msisdn.length > 0 && !validMsisdn ? (
                <FieldError>
                  Enter a valid E.164 number, e.g. +233201234567.
                </FieldError>
              ) : (
                <FieldDescription>
                  International format, starting with +.
                </FieldDescription>
              )}
            </Field>

            <Field>
              <FieldLabel htmlFor="test-channel">Channel</FieldLabel>
              <Select
                value={chosen}
                onValueChange={(v) => setChannel(v as VerifyChannelName)}
                disabled={options.length === 0}
              >
                <SelectTrigger id="test-channel">
                  <SelectValue placeholder="Choose a channel" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CHANNEL_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {options.length === 0 ? (
                <FieldError>
                  Enable at least one channel to send a test.
                </FieldError>
              ) : null}
            </Field>

            <Button className="mt-auto" onClick={send} disabled={!canSend}>
              {busy ? "Sending…" : "Send test code"}
            </Button>
          </>
        ) : null}

        {step === "code" ? (
          <>
            <p className="text-sm text-muted-foreground">
              Code sent to{" "}
              <span className="font-mono text-foreground">
                {pending?.msisdn}
              </span>{" "}
              via {pending ? CHANNEL_LABEL[pending.channel] : ""}. Enter the
              6-digit code.
            </p>
            <Field>
              <FieldLabel htmlFor="test-code">Verification code</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <KeyRound />
                </InputGroupAddon>
                <InputGroupInput
                  id="test-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  className="font-mono tracking-[0.4em] tabular-nums"
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") verify();
                  }}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    variant="default"
                    onClick={verify}
                    disabled={code.trim().length === 0 || busy}
                  >
                    {busy ? "Verifying…" : "Verify"}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription>
                Demo: enter{" "}
                <span className="font-mono text-foreground">
                  {DEMO_OK_CODE}
                </span>{" "}
                to simulate success.
              </FieldDescription>
            </Field>
            <Button
              variant="ghost"
              className="mt-auto self-start"
              onClick={reset}
            >
              Cancel
            </Button>
          </>
        ) : null}

        {step === "done" && outcome ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-4 text-center">
            <span
              className={cn(
                "flex size-12 items-center justify-center rounded-full",
                outcome.status === "verified"
                  ? "bg-success/12 text-success"
                  : "bg-destructive/12 text-destructive",
              )}
            >
              {outcome.status === "verified" ? (
                <CheckCircle2 className="size-6" />
              ) : (
                <XCircle className="size-6" />
              )}
            </span>
            <div className="flex flex-col gap-1">
              <p className="font-display text-lg font-semibold">
                {outcome.status === "verified" ? "Verified" : "Incorrect code"}
              </p>
              <p className="text-sm text-muted-foreground">
                {outcome.status === "verified"
                  ? `${outcome.msisdn} confirmed via ${CHANNEL_LABEL[outcome.channel]}.`
                  : "That code didn't match. Try again or send a new one."}
              </p>
            </div>
            <div className="mt-2 flex gap-2">
              {outcome.status !== "verified" ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setCode("");
                    setOutcome(null);
                    setStep("code");
                  }}
                >
                  Re-enter code
                </Button>
              ) : null}
              <Button
                variant={outcome.status === "verified" ? "default" : "ghost"}
                onClick={reset}
              >
                Send another
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
