"use client";

import type { PriceBookDto } from "@app/contracts";
import { Button } from "@app/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Switch } from "@app/ui/components/ui/switch";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

interface RateRow {
  id: string;
  channel: "sms" | "email";
  currency: string;
  price: string;
}

function newRow(): RateRow {
  return {
    id: crypto.randomUUID(),
    channel: "sms",
    currency: "GHS",
    price: "",
  };
}

interface ErrorPayload {
  error?: { message?: string };
}

function initialRows(book: PriceBookDto | null): RateRow[] {
  if (book && book.rates.length > 0) {
    return book.rates.map((r) => ({
      id: crypto.randomUUID(),
      channel: r.channel,
      currency: r.currency,
      price: r.unit_price_minor,
    }));
  }
  return [newRow()];
}

/** Create (book === null) or edit a price book: identity + a dynamic per-channel/currency rate table. */
export function PriceBookEditorDialog({
  open,
  onOpenChange,
  book,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  book: PriceBookDto | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(book?.name ?? "");
  const [description, setDescription] = useState(book?.description ?? "");
  const [isDefault, setIsDefault] = useState(book?.is_default ?? false);
  const [rows, setRows] = useState<RateRow[]>(() => initialRows(book));
  const [busy, setBusy] = useState(false);

  const ratesValid =
    rows.length > 0 &&
    rows.every(
      (r) => /^[A-Za-z]{3}$/.test(r.currency) && /^[1-9]\d*$/.test(r.price),
    );
  // A (channel, currency) pair is unique per book (the DB index would 500 on a duplicate).
  const noDuplicates =
    new Set(rows.map((r) => `${r.channel}:${r.currency.toUpperCase()}`))
      .size === rows.length;
  const valid = name.trim().length > 0 && ratesValid && noDuplicates;

  function setRow(index: number, patch: Partial<RateRow>) {
    setRows((current) =>
      current.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  }

  async function save() {
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        mode: "subscription" as const,
        description: description.trim(),
        is_default: isDefault,
        rates: rows.map((r) => ({
          channel: r.channel,
          currency: r.currency.toUpperCase(),
          unit_price_minor: r.price,
        })),
      };
      const response = await fetch(
        book ? `/api/admin/price-books/${book.id}` : "/api/admin/price-books",
        {
          method: book ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        const payload = (await response
          .json()
          .catch(() => null)) as ErrorPayload | null;
        throw new Error(payload?.error?.message ?? "Couldn't save the book.");
      }
      toast.success(`Price book ${book ? "updated" : "created"}`);
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't save the book.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {book ? "Edit price book" : "New price book"}
          </DialogTitle>
          <DialogDescription>
            Prices are minor units (pesewas/kobo/cents). SMS is per segment,
            email flat per send. Each change is audited.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="pb-name">Name</FieldLabel>
            <Input
              id="pb-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Subscription — Loyalty"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="pb-desc">Description</FieldLabel>
            <Input
              id="pb-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          </Field>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="flex flex-col">
              <span className="text-sm font-medium">
                Default for subscription
              </span>
              <span className="text-xs text-muted-foreground">
                New/unassigned accounts resolve to the default book.
              </span>
            </div>
            <Switch checked={isDefault} onCheckedChange={setIsDefault} />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Rates</span>
            {rows.map((row, index) => (
              <div key={row.id} className="flex items-end gap-2">
                <Select
                  value={row.channel}
                  onValueChange={(v) =>
                    setRow(index, { channel: v as "sms" | "email" })
                  }
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sms">SMS</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  aria-label="Currency"
                  className="w-24 uppercase"
                  value={row.currency}
                  maxLength={3}
                  onChange={(e) => setRow(index, { currency: e.target.value })}
                  placeholder="GHS"
                />
                <Input
                  aria-label="Unit price (minor units)"
                  className="flex-1"
                  inputMode="numeric"
                  value={row.price}
                  onChange={(e) =>
                    setRow(index, {
                      price: e.target.value.replace(/[^\d]/g, ""),
                    })
                  }
                  placeholder="Price in minor units"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={rows.length === 1}
                  onClick={() =>
                    setRows((current) => current.filter((_, i) => i !== index))
                  }
                  aria-label="Remove rate"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            {!noDuplicates ? (
              <p className="text-xs text-destructive">
                Each channel + currency pair can appear only once.
              </p>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setRows((current) => [...current, newRow()])}
            >
              Add rate
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button disabled={!valid} loading={busy} onClick={save}>
            {book ? "Save changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
