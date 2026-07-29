"use client";

import type { PriceBookDto } from "@app/contracts";
import { Button } from "@app/ui/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

const DEFAULT_VALUE = "__default__";

interface ErrorPayload {
  error?: { message?: string };
}

/** Assign a tenant to a price book (or clear → the mode default). staff:write; the change is audited. */
export function AccountPriceBookAssign({
  accountId,
  currentBookId,
  currentBillingCurrency,
  books,
}: {
  accountId: string;
  currentBookId: string | null;
  currentBillingCurrency: "GHS" | "NGN" | "USD";
  books: readonly PriceBookDto[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(currentBookId ?? DEFAULT_VALUE);
  const [billingCurrency, setBillingCurrency] = useState(
    currentBillingCurrency,
  );
  const [busy, setBusy] = useState(false);
  const dirty =
    selected !== (currentBookId ?? DEFAULT_VALUE) ||
    billingCurrency !== currentBillingCurrency;

  async function save() {
    setBusy(true);
    try {
      const priceBookId = selected === DEFAULT_VALUE ? null : selected;
      const response = await fetch(
        `/api/admin/price-books/assignments/${encodeURIComponent(accountId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            price_book_id: priceBookId,
            billing_currency: billingCurrency,
          }),
        },
      );
      if (!response.ok) {
        const payload = (await response
          .json()
          .catch(() => null)) as ErrorPayload | null;
        throw new Error(payload?.error?.message ?? "Couldn't update pricing.");
      }
      toast.success("Price book updated");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't update pricing.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={selected} onValueChange={setSelected}>
        <SelectTrigger className="w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_VALUE}>Default (by mode)</SelectItem>
          {books.map((book) => (
            <SelectItem key={book.id} value={book.id}>
              {book.name}
              {book.is_default ? " · default" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={billingCurrency}
        onValueChange={(value) =>
          setBillingCurrency(value as "GHS" | "NGN" | "USD")
        }
      >
        <SelectTrigger className="w-28" aria-label="Billing currency">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="GHS">GHS</SelectItem>
          <SelectItem value="NGN">NGN</SelectItem>
          <SelectItem value="USD">USD</SelectItem>
        </SelectContent>
      </Select>
      <Button size="sm" disabled={!dirty} loading={busy} onClick={save}>
        Save
      </Button>
    </div>
  );
}
