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
import { CheckCircle2, Loader2, Plus } from "lucide-react";
import { useId, useState } from "react";
import { formatMoney, parseAmountToMinor } from "@/lib/money";

type Phase = "form" | "processing" | "done";

const CURRENCIES = currencySchema.options;

/**
 * Top-up flow (mock): enter amount → payment-provider handoff (pending) → credited.
 * Amount is parsed to exact minor units (bigint string math, never float).
 * TODO(BFF): replace the mock timer with real payment-provider initiation + callback poll; surface
 * failures via toastApiError (@/lib/error-toast).
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

  function submit() {
    if (!valid) return;
    setPhase("processing");
    // Mock provider handoff → credited.
    setTimeout(() => setPhase("done"), 1400);
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
            <p className="font-medium">Waiting for payment confirmation…</p>
            <p className="text-sm text-muted-foreground">
              Complete the payment with your provider. This closes automatically
              once we receive the confirmation.
            </p>
          </div>
        )}

        {phase === "done" && (
          <>
            <div
              className="flex flex-col items-center gap-3 py-6 text-center"
              aria-live="polite"
            >
              <CheckCircle2 className="size-8 text-success" />
              <p className="font-medium">Wallet credited</p>
              <p className="font-display text-2xl tabular-nums">
                {formatMoney(previewMoney)}
              </p>
              <p className="text-sm text-muted-foreground">
                Your balance is updated. The top-up appears in your transactions
                below.
              </p>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button>Done</Button>
              </DialogClose>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
