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
import { useForm } from "@tanstack/react-form";
import { ArrowRight, FlaskConical, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { PhoneInput } from "@/components/phone-input";
import {
  confirmFlow,
  type StartResponse,
  startFlow,
  type TransactionRecord,
} from "@/lib/client/flows-api";
import { toastApiError } from "@/lib/error-toast";
import {
  CURRENCY,
  E164,
  parseMinor,
  schema,
} from "./run-test-transaction-dialog.schema";

/**
 * Dev/QA affordance — run ONE verify→charge→notify by hand to see the reconciled record. In
 * production this flow fires from the API (checkout/login), not a form; this is a sandbox "try it".
 * The two-phase flow (form→otp), the started response, and the busy flag stay local state; the
 * validated inputs live in a single TanStack Form.
 */
export function RunTestTransactionDialog({
  onCreated,
}: {
  onCreated: (record: TransactionRecord) => void;
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"form" | "otp">("form");
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState<StartResponse | null>(null);

  const form = useForm({
    defaultValues: { msisdn: "", amount: "", channel: "sms", code: "" },
    validators: { onChange: schema },
  });

  function reset() {
    setPhase("form");
    setStarted(null);
    form.reset();
  }

  async function start() {
    const { msisdn, amount, channel } = form.state.values;
    const minor = parseMinor(amount);
    if (!(E164.test(msisdn.trim()) && minor !== null) || busy) return;
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
    const { msisdn, amount, channel, code } = form.state.values;
    const minor = parseMinor(amount);
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
            <form.Field name="msisdn">
              {(field) => {
                const showError =
                  field.state.value.length > 0 &&
                  !E164.test(field.state.value.trim());
                return (
                  <Field data-invalid={showError || undefined}>
                    <FieldLabel htmlFor="t-msisdn">Customer phone</FieldLabel>
                    <PhoneInput
                      id="t-msisdn"
                      value={field.state.value}
                      onChange={field.handleChange}
                      invalid={showError}
                    />
                    {showError ? (
                      <FieldError>Enter a valid phone number.</FieldError>
                    ) : (
                      <FieldDescription>
                        Pick the country, then type the local number.
                      </FieldDescription>
                    )}
                  </Field>
                );
              }}
            </form.Field>
            <div className="grid grid-cols-2 gap-4">
              <form.Field name="amount">
                {(field) => {
                  const showError =
                    field.state.value.length > 0 &&
                    parseMinor(field.state.value) === null;
                  return (
                    <Field data-invalid={showError || undefined}>
                      <FieldLabel htmlFor="t-amount">Amount (GHS)</FieldLabel>
                      <Input
                        id="t-amount"
                        inputMode="decimal"
                        placeholder="50.00"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        className="font-mono tabular-nums"
                      />
                    </Field>
                  );
                }}
              </form.Field>
              <form.Field name="channel">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor="t-channel">Notify via</FieldLabel>
                    <Select
                      value={field.state.value}
                      onValueChange={field.handleChange}
                    >
                      <SelectTrigger id="t-channel" className="uppercase">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sms">SMS</SelectItem>
                        <SelectItem value="whatsapp">WhatsApp</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              </form.Field>
            </div>
            <form.Subscribe
              selector={(s) => ({
                msisdn: s.values.msisdn,
                amount: s.values.amount,
              })}
            >
              {({ msisdn, amount }) => {
                const canStart =
                  E164.test(msisdn.trim()) &&
                  parseMinor(amount) !== null &&
                  !busy;
                return (
                  <Button
                    className="self-start"
                    onClick={start}
                    loading={busy}
                    disabled={!canStart}
                  >
                    Start
                    <ArrowRight data-icon="inline-end" />
                  </Button>
                );
              }}
            </form.Subscribe>
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
            <form.Field name="code">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor="t-code">Verification code</FieldLabel>
                  <Input
                    id="t-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="123456"
                    value={field.state.value}
                    onChange={(e) =>
                      field.handleChange(
                        e.target.value.replace(/\D/g, "").slice(0, 6),
                      )
                    }
                    className="font-mono tracking-[0.4em] tabular-nums"
                  />
                  <FieldDescription>
                    Authorizes a balanced double-entry charge, then the
                    confirmation.
                  </FieldDescription>
                </Field>
              )}
            </form.Field>
            <form.Subscribe selector={(s) => s.values.code}>
              {(code) => (
                <Button
                  className="self-start"
                  onClick={confirm}
                  disabled={code.trim().length === 0 || busy}
                >
                  <ShieldCheck data-icon="inline-start" />
                  {busy ? "Running…" : "Verify & run"}
                </Button>
              )}
            </form.Subscribe>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
