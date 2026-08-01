"use client";

import type { PriceBookDto } from "@app/contracts";
import { Button } from "@app/ui/components/ui/button";
import { Input } from "@app/ui/components/ui/input";
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
import { assignCatalog, OfferError } from "@/lib/client/commercial-offers-api";

const DEFAULT_VALUE = "__default__";

/**
 * Which prepaid catalog this workspace buys bundles from (COM-011). Separate from the pay-as-you-go
 * price book above it: a negotiated bundle catalog and a negotiated per-unit rate are independent
 * commercial decisions, and coupling them would force one to change whenever the other did.
 *
 * Changing this affects FUTURE purchases only — a purchase snapshots the version it bought.
 */
export function OfferCatalogAssign({
  accountId,
  currentCatalogId,
  catalogs,
}: {
  accountId: string;
  currentCatalogId: string | null;
  catalogs: readonly PriceBookDto[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(currentCatalogId ?? DEFAULT_VALUE);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty = selected !== (currentCatalogId ?? DEFAULT_VALUE);

  if (catalogs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No prepaid catalogs exist yet, so this workspace has nothing to be
        assigned.
      </p>
    );
  }

  async function save() {
    setBusy(true);
    try {
      await assignCatalog(accountId, {
        offer_catalog_id: selected === DEFAULT_VALUE ? null : selected,
        reason: reason.trim(),
      });
      toast.success(
        selected === DEFAULT_VALUE
          ? "Workspace moved back to the default catalog."
          : "Prepaid catalog assigned.",
      );
      setReason("");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof OfferError
          ? error.message
          : "The catalog could not be assigned.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select value={selected} onValueChange={setSelected}>
        <SelectTrigger className="w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_VALUE}>Default catalog</SelectItem>
          {catalogs.map((catalog) => (
            <SelectItem key={catalog.id} value={catalog.id}>
              {catalog.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        className="w-64"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Why (negotiated terms, partner…)"
      />
      <Button size="sm" onClick={save} disabled={!dirty || busy}>
        Save
      </Button>
    </div>
  );
}
