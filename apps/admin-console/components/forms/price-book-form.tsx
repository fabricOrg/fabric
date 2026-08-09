"use client";

import {
  currency,
  type PriceBookDto,
  type PriceBookMode,
  type PriceBookRateDto,
} from "@app/contracts";
import { Button } from "@app/ui/components/ui/button";
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

/**
 * The currencies the platform can settle, straight from the contract enum rather than a second list
 * here — a free-text box previously accepted any 3 letters, so a book could be priced in a currency
 * with no minor-unit scale and nothing able to bill it.
 */
const CURRENCIES = currency.options;

interface RateRow {
  id: string;
  // Derived from the DTO rather than restated, so a new billable channel cannot leave this form
  // silently unable to represent a rate the backend already accepts.
  channel: PriceBookRateDto["channel"];
  currency: string;
  price: string;
}

function newRow(): RateRow {
  return {
    id: crypto.randomUUID(),
    channel: "sms",
    currency: CURRENCIES[0] ?? "GHS",
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

/**
 * Create (book === null) or edit a price book. Lives on its own page rather than in a dialog: a
 * book carries one rate per channel per currency, so even three currencies is six rows plus the
 * identity fields — enough that a modal scrolled its own body and clipped the "Add rate" control.
 */
export function PriceBookForm({ book }: { book: PriceBookDto | null }) {
  const router = useRouter();
  const [name, setName] = useState(book?.name ?? "");
  const [description, setDescription] = useState(book?.description ?? "");
  const [mode, setMode] = useState<PriceBookMode>(book?.mode ?? "subscription");
  const [isDefault, setIsDefault] = useState(book?.is_default ?? false);
  const [isPublic, setIsPublic] = useState(book?.is_public ?? false);
  const [minimumMarginBps, setMinimumMarginBps] = useState(
    String(book?.minimum_margin_bps ?? 2_000),
  );
  const [rows, setRows] = useState<RateRow[]>(() => initialRows(book));
  const [busy, setBusy] = useState(false);

  // Mirrors the contract: a settleable currency, and a strictly positive integer of minor units.
  // The currency check is set membership rather than a shape test — "XYZ" is three letters and was
  // previously accepted all the way through to the database.
  const ratesValid =
    rows.length > 0 &&
    rows.every(
      (r) =>
        (CURRENCIES as readonly string[]).includes(r.currency) &&
        /^[1-9]\d*$/.test(r.price),
    );
  // A (channel, currency) pair is unique per book (the DB index would 500 on a duplicate).
  const noDuplicates =
    new Set(rows.map((r) => `${r.channel}:${r.currency}`)).size === rows.length;
  const marginValid =
    /^\d+$/.test(minimumMarginBps) &&
    Number(minimumMarginBps) >= 0 &&
    Number(minimumMarginBps) <= 10_000;
  const valid =
    name.trim().length > 0 && ratesValid && noDuplicates && marginValid;

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
        mode,
        description: description.trim(),
        is_default: isDefault,
        is_public: isPublic,
        minimum_margin_bps: Number(minimumMarginBps),
        rates: rows.map((r) => ({
          channel: r.channel,
          currency: r.currency,
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
      // Back to the list, which re-renders from the server with the saved values.
      router.push("/pricing");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't save the book.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
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
        <Field>
          <FieldLabel htmlFor="pb-margin">
            Minimum margin (basis points)
          </FieldLabel>
          <Input
            id="pb-margin"
            inputMode="numeric"
            value={minimumMarginBps}
            onChange={(event) => setMinimumMarginBps(event.target.value)}
            aria-invalid={!marginValid}
          />
          <span className="text-xs text-muted-foreground">
            2,000 = 20%. Live sends fail closed when provider cost breaches this
            floor.
          </span>
        </Field>
        <Field>
          <FieldLabel htmlFor="pb-mode">Purchase mode</FieldLabel>
          <Select
            value={mode}
            onValueChange={(v) => setMode(v as PriceBookMode)}
            // A book's mode decides how accounts resolve against it, and a token lot has already
            // locked its price from it — switching an existing book's mode would strand both.
            disabled={book !== null}
          >
            <SelectTrigger id="pb-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="subscription">
                Subscription — pay-as-you-go from the wallet
              </SelectItem>
              <SelectItem value="token">
                Token — one-off, price locked at purchase
              </SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {book
              ? "A book's mode is fixed once created."
              : "Token prices are locked into each purchase, so later edits never reprice tokens already bought."}
          </span>
        </Field>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="flex flex-col">
            <span className="text-sm font-medium">
              Default for {mode === "token" ? "token" : "subscription"}
            </span>
            <span className="text-xs text-muted-foreground">
              {mode === "token"
                ? "Token purchases price against this book when no other is assigned."
                : "New/unassigned accounts resolve to the default book."}
            </span>
          </div>
          <Switch checked={isDefault} onCheckedChange={setIsDefault} />
        </div>
        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="flex flex-col">
            <span className="text-sm font-medium">Published publicly</span>
            <span className="text-xs text-muted-foreground">
              Show this book&apos;s sanitized rates on public pricing surfaces.
            </span>
          </div>
          <Switch checked={isPublic} onCheckedChange={setIsPublic} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">Rates</span>
          <span className="text-xs text-muted-foreground">
            Prices are minor units (pesewas/kobo/cents). SMS is per segment,
            email flat per send. Each change is audited.
          </span>
        </div>
        {rows.map((row, index) => (
          <div key={row.id} className="flex items-end gap-2">
            <Select
              value={row.channel}
              onValueChange={(v) =>
                setRow(index, { channel: v as PriceBookRateDto["channel"] })
              }
            >
              <SelectTrigger className="w-28" aria-label="Channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sms">SMS</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={row.currency}
              onValueChange={(v) => setRow(index, { currency: v })}
            >
              <SelectTrigger className="w-24" aria-label="Currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button
          variant="outline"
          onClick={() => router.push("/pricing")}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button disabled={!valid} loading={busy} onClick={save}>
          {book ? "Save changes" : "Create price book"}
        </Button>
      </div>
    </div>
  );
}
