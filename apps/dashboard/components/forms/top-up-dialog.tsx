"use client";

import { type Currency, currency as currencySchema } from "@app/contracts";
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
import { Field, FieldLabel } from "@app/ui/components/ui/field";
import { Input } from "@app/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { useForm } from "@tanstack/react-form";
import { Loader2, Plus } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { formatMoney, parseAmountToMinor } from "@/lib/money";

type Phase = "form" | "review" | "processing";

const CURRENCIES = currencySchema.options;

/** All supported currencies are 2-decimal, so a fixed yardstick validates the amount identically. */
const schema = z.object({
  amount: z.string().refine((v) => {
    const m = parseAmountToMinor(v, "GHS");
    return m !== null && m > 0n;
  }, "Enter an amount greater than zero."),
});

/**
 * Top-up flow: enter amount → initiate a real Paystack charge (BFF) → redirect to hosted checkout.
 * The wallet credits asynchronously via the /webhooks/paystack callback on charge.success. Amount is
 * parsed to exact minor units (bigint string math, never float). Currency + phase stay local state;
 * only the validated amount lives in the form.
 */
export function TopUpDialog({
  defaultCurrency = "GHS",
}: {
  defaultCurrency?: Currency;
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [currency, setCurrency] = useState<Currency>(defaultCurrency);
  const amountId = useId();

  const form = useForm({
    defaultValues: { amount: "" },
    validators: { onMount: schema, onChange: schema },
    onSubmit: () => setPhase("review"),
  });

  async function startPayment() {
    const minor = parseAmountToMinor(form.state.values.amount, currency);
    if (minor === null || minor <= 0n) return;
    setPhase("processing");
    try {
      const response = await fetch("/api/dashboard/wallet/topup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount_minor: minor.toString(),
          currency,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(
          payload?.error?.message ?? "Couldn't start the top-up.",
        );
      }
      const { authorization_url } = (await response.json()) as {
        authorization_url: string;
      };
      // Hand off to the provider's hosted checkout; the wallet credits via webhook on success.
      window.location.href = authorization_url;
    } catch (error) {
      setPhase("review");
      toast.error(
        error instanceof Error ? error.message : "Couldn't start the top-up.",
      );
    }
  }

  function reset() {
    setPhase("form");
    setCurrency(defaultCurrency);
    form.reset();
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
        <Button size="sm">
          <Plus data-icon="inline-start" />
          Top up
        </Button>
      </DialogTrigger>
      <DialogContent>
        {phase === "form" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <DialogHeader>
              <DialogTitle>Top up wallet</DialogTitle>
              <DialogDescription>
                Add funds via your payment provider. Balance credits once the
                payment is confirmed.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-2">
              <form.Field name="amount">
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={amountId}>Amount</FieldLabel>
                    <div className="flex gap-2">
                      <Select
                        value={currency}
                        onValueChange={(v) => setCurrency(v as Currency)}
                      >
                        <SelectTrigger className="w-28" aria-label="Currency">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CURRENCIES.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        id={amountId}
                        inputMode="decimal"
                        placeholder="0.00"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        className="font-mono tabular-nums"
                      />
                    </div>
                  </Field>
                )}
              </form.Field>
              <form.Subscribe selector={(s) => s.values.amount}>
                {(amount) => {
                  const minor = parseAmountToMinor(amount, currency);
                  if (minor === null || minor <= 0n) return null;
                  return (
                    <p className="text-sm text-muted-foreground">
                      You&apos;ll be charged{" "}
                      <span className="font-mono tabular-nums text-foreground">
                        {formatMoney({ currency, minor: minor.toString() })}
                      </span>{" "}
                      by your payment provider.
                    </p>
                  );
                }}
              </form.Subscribe>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <form.Subscribe selector={(s) => s.canSubmit}>
                {(canSubmit) => (
                  <Button type="submit" disabled={!canSubmit}>
                    Continue to payment
                  </Button>
                )}
              </form.Subscribe>
            </DialogFooter>
          </form>
        )}

        {phase === "review" && (
          <div className="flex flex-col gap-5">
            <DialogHeader>
              <DialogTitle>Confirm wallet top-up</DialogTitle>
              <DialogDescription>
                Review the charge before continuing to Paystack&apos;s hosted
                checkout.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-md border p-4">
              <p className="text-sm text-muted-foreground">
                You will authorize
              </p>
              <p className="mt-1 font-display text-3xl font-semibold tabular-nums">
                {formatMoney({
                  currency,
                  minor:
                    parseAmountToMinor(
                      form.state.values.amount,
                      currency,
                    )?.toString() ?? "0",
                })}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Your Fabric balance changes only after Paystack confirms a
                successful payment. Closing or failing checkout does not credit
                the wallet.
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPhase("form")}
              >
                Back
              </Button>
              <Button type="button" onClick={() => void startPayment()}>
                Continue to secure payment
              </Button>
            </DialogFooter>
          </div>
        )}

        {phase === "processing" && (
          <div
            className="flex flex-col items-center gap-3 py-8 text-center"
            aria-live="polite"
          >
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="font-medium">Redirecting to secure checkout…</p>
            <p className="text-sm text-muted-foreground">
              Complete the payment with your provider. Your balance credits once
              the payment is confirmed.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
