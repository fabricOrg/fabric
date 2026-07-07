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
import { Loader2, Plus } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { formatMoney, parseAmountToMinor } from "@/lib/money";

type Phase = "form" | "processing";

const CURRENCIES = currencySchema.options;

/**
 * Top-up flow: enter amount → initiate a real Paystack charge (BFF) → redirect to hosted checkout.
 * The wallet credits asynchronously via the /webhooks/paystack callback on charge.success. Amount is
 * parsed to exact minor units (bigint string math, never float).
 */
export function TopUpDialog({
  defaultCurrency = "GHS",
}: {
  defaultCurrency?: Currency;
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [currency, setCurrency] = useState<Currency>(defaultCurrency);
  const [amount, setAmount] = useState("");
  const amountId = useId();

  const minor = parseAmountToMinor(amount, currency);
  const valid = minor !== null && minor > 0n;
  const previewMoney = { currency, minor: (minor ?? 0n).toString() };

  function reset() {
    setPhase("form");
    setAmount("");
    setCurrency(defaultCurrency);
  }

  async function submit() {
    if (!valid || minor === null) return;
    setPhase("processing");
    try {
      const response = await fetch("/api/dashboard/wallet/topup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount_minor: minor.toString(), currency }),
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
      setPhase("form");
      toast.error(
        error instanceof Error ? error.message : "Couldn't start the top-up.",
      );
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
        <Button size="sm">
          <Plus data-icon="inline-start" />
          Top up
        </Button>
      </DialogTrigger>
      <DialogContent>
        {phase === "form" && (
          <>
            <DialogHeader>
              <DialogTitle>Top up wallet</DialogTitle>
              <DialogDescription>
                Add funds via your payment provider. Balance credits once the
                payment is confirmed.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 py-2">
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
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="font-mono tabular-nums"
                  />
                </div>
              </Field>
              {valid && (
                <p className="text-sm text-muted-foreground">
                  You&apos;ll be charged{" "}
                  <span className="font-mono tabular-nums text-foreground">
                    {formatMoney(previewMoney)}
                  </span>{" "}
                  by your payment provider.
                </p>
              )}
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button onClick={submit} disabled={!valid}>
                Continue to payment
              </Button>
            </DialogFooter>
          </>
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
