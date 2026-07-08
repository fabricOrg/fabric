"use client";

import {
  type AutoTopupResponse,
  type Currency,
  currency as currencySchema,
} from "@app/contracts";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { useForm } from "@tanstack/react-form";
import { Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { formatMoney, parseAmountToMinor } from "@/lib/money";

/** Minor units (string) → major display for prefilling an input (exact bigint math, no float).
 *  All supported currencies (GHS/NGN/USD) are 2-decimal. */
function minorToInput(minorStr: string): string {
  const minor = BigInt(minorStr);
  return `${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")}`;
}

/** Threshold may be zero; top-up must be positive. Currencies are all 2-decimal, so a fixed yardstick. */
const schema = z.object({
  threshold: z.string().refine((v) => {
    const m = parseAmountToMinor(v, "GHS");
    return m !== null && m >= 0n;
  }, "Enter a valid threshold."),
  topUp: z.string().refine((v) => {
    const m = parseAmountToMinor(v, "GHS");
    return m !== null && m > 0n;
  }, "Enter an amount greater than zero."),
});

/**
 * Configure auto top-up: when the balance falls to/below the threshold, Fabric charges the saved card
 * for the top-up amount (the credit lands via the Paystack webhook, same idempotent path as a manual
 * top-up). Enabling REQUIRES a reusable card on file — the API rejects it otherwise, so we gate the
 * trigger on `hasCard`. Amounts are parsed to exact minor units (bigint), never float. Currency stays
 * local state (it drives the copy); the two amounts live in the form.
 */
export function AutoTopupDialog({
  config,
  hasCard,
  defaultCurrency = "GHS",
}: {
  config: AutoTopupResponse["config"];
  hasCard: boolean;
  defaultCurrency?: Currency;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [currency, setCurrency] = useState<Currency>(
    (config?.currency as Currency | undefined) ?? defaultCurrency,
  );
  const thresholdId = useId();
  const topUpId = useId();

  const form = useForm({
    defaultValues: {
      threshold: config ? minorToInput(config.threshold_minor) : "",
      topUp: config ? minorToInput(config.top_up_minor) : "",
    },
    validators: { onMount: schema, onChange: schema },
  });

  async function save(enabled: boolean) {
    const thresholdMinor = parseAmountToMinor(
      form.state.values.threshold,
      currency,
    );
    const topUpMinor = parseAmountToMinor(form.state.values.topUp, currency);
    if (
      enabled &&
      (thresholdMinor === null ||
        thresholdMinor < 0n ||
        topUpMinor === null ||
        topUpMinor <= 0n)
    ) {
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/dashboard/wallet/auto-topup", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled,
          threshold_minor: (thresholdMinor ?? 0n).toString(),
          top_up_minor: (topUpMinor ?? 1n).toString(),
          currency,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(
          payload?.error?.message ?? "Couldn't save auto top-up.",
        );
      }
      toast.success(
        enabled ? "Auto top-up enabled." : "Auto top-up turned off.",
      );
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't save auto top-up.",
      );
    } finally {
      setSaving(false);
    }
  }

  const enabled = config?.enabled ?? false;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={!hasCard}>
          <Settings2 data-icon="inline-start" />
          {enabled ? "Manage" : "Set up"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Auto top-up</DialogTitle>
          <DialogDescription>
            When your {currency} balance drops to the threshold, we charge your
            saved card for the top-up amount. The credit lands once the payment
            is confirmed.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <form.Field name="threshold">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={thresholdId}>
                  When balance drops to
                </FieldLabel>
                <div className="flex gap-2">
                  <Select
                    value={currency}
                    onValueChange={(v) => setCurrency(v as Currency)}
                  >
                    <SelectTrigger className="w-28" aria-label="Currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {currencySchema.options.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    id={thresholdId}
                    inputMode="decimal"
                    placeholder="0.00"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    className="font-mono tabular-nums"
                  />
                </div>
                <FieldDescription>
                  The trigger balance — set it high enough to cover in-flight
                  sends.
                </FieldDescription>
              </Field>
            )}
          </form.Field>
          <form.Field name="topUp">
            {(field) => {
              const topUpMinor = parseAmountToMinor(
                field.state.value,
                currency,
              );
              return (
                <Field>
                  <FieldLabel htmlFor={topUpId}>Top up by</FieldLabel>
                  <Input
                    id={topUpId}
                    inputMode="decimal"
                    placeholder="0.00"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    className="font-mono tabular-nums"
                  />
                  {topUpMinor !== null && topUpMinor > 0n && (
                    <FieldDescription>
                      We&apos;ll charge{" "}
                      <span className="font-mono tabular-nums text-foreground">
                        {formatMoney({
                          currency,
                          minor: topUpMinor.toString(),
                        })}
                      </span>{" "}
                      each time.
                    </FieldDescription>
                  )}
                </Field>
              );
            }}
          </form.Field>
        </div>
        <DialogFooter className="sm:justify-between">
          {enabled ? (
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={() => save(false)}
              loading={saving}
            >
              Turn off
            </Button>
          ) : (
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
          )}
          <form.Subscribe selector={(s) => s.canSubmit}>
            {(canSubmit) => (
              <Button
                onClick={() => save(true)}
                disabled={!canSubmit}
                loading={saving}
              >
                {enabled ? "Save changes" : "Enable auto top-up"}
              </Button>
            )}
          </form.Subscribe>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
