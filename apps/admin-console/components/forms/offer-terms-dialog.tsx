"use client";

import type {
  CommercialOfferVersionDto,
  CommercialOfferWithVersions,
  Currency,
} from "@app/contracts";
import { Button } from "@app/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { MarginVerdict } from "@/components/offer-margin-verdict";
import {
  createVersion,
  OfferError,
  previewMargin,
  updateVersion,
} from "@/lib/client/commercial-offers-api";
import { useOfferTermsForm } from "@/lib/client/offer-terms-form";

const CURRENCIES: readonly Currency[] = ["GHS", "NGN", "USD"];

export function OfferTermsDialog({
  offer,
  version,
  open,
  onOpenChange,
}: {
  offer: CommercialOfferWithVersions;
  /** Editing an existing draft, or null to author a new one. */
  version: CommercialOfferVersionDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const fieldId = useId();
  const form = useOfferTermsForm(version);
  const [busy, setBusy] = useState(false);
  // The verdict is stored WITH the fingerprint of the terms it judged. Editing a field then leaves a
  // visibly stale verdict instead of a green badge earned by numbers that no longer exist.
  const [verdict, setVerdict] = useState<{
    fingerprint: string;
    preview: Awaited<ReturnType<typeof previewMargin>>;
  } | null>(null);
  const stale = verdict !== null && verdict.fingerprint !== form.fingerprint;

  async function check() {
    if (!form.valid) return;
    setBusy(true);
    try {
      const fingerprint = form.fingerprint;
      const preview = await previewMargin({
        offer_id: offer.id,
        ...form.terms(),
      });
      setVerdict({ fingerprint, preview });
    } catch (error) {
      toast.error(
        error instanceof OfferError
          ? error.message
          : "The margin check could not be run.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!form.valid) return;
    setBusy(true);
    try {
      if (version) {
        await updateVersion(version.id, form.terms());
        toast.success(`Draft v${version.version} updated.`);
      } else {
        const created = await createVersion(offer.id, form.terms());
        toast.success(`Draft v${created.version} created.`);
      }
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof OfferError
          ? error.message
          : "The draft could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {version ? `Edit draft v${version.version}` : "New draft terms"}
          </DialogTitle>
          <DialogDescription>
            {offer.name} — priced per {offer.unit_code}. A published version is
            never edited; clone it instead.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${fieldId}-units`}>
              Included {offer.unit_code}s
            </FieldLabel>
            <Input
              id={`${fieldId}-units`}
              inputMode="numeric"
              value={form.units}
              onChange={(event) => form.setUnits(event.target.value)}
              placeholder="200"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${fieldId}-amount`}>Total price</FieldLabel>
            <div className="flex gap-2">
              <Select
                value={form.currency}
                onValueChange={(next) => form.setCurrency(next as Currency)}
              >
                <SelectTrigger className="w-24">
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
                id={`${fieldId}-amount`}
                inputMode="decimal"
                value={form.amount}
                onChange={(event) => form.setAmount(event.target.value)}
                placeholder="3.00"
              />
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${fieldId}-min`}>Min packs</FieldLabel>
            <Input
              id={`${fieldId}-min`}
              inputMode="numeric"
              value={form.minimumPacks}
              onChange={(event) => form.setMinimumPacks(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${fieldId}-max`}>
              Max packs (blank = unlimited)
            </FieldLabel>
            <Input
              id={`${fieldId}-max`}
              inputMode="numeric"
              value={form.maximumPacks}
              onChange={(event) => form.setMaximumPacks(event.target.value)}
            />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor={`${fieldId}-countries`}>
              Destinations (ISO codes, blank = any)
            </FieldLabel>
            <Input
              id={`${fieldId}-countries`}
              value={form.countries}
              onChange={(event) => form.setCountries(event.target.value)}
              placeholder="GH, NG"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${fieldId}-traffic`}>
              Traffic classes (blank = any)
            </FieldLabel>
            <Input
              id={`${fieldId}-traffic`}
              value={form.trafficClasses}
              onChange={(event) => form.setTrafficClasses(event.target.value)}
              placeholder="transactional"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${fieldId}-vendors`}>
              Providers (required)
            </FieldLabel>
            <Input
              id={`${fieldId}-vendors`}
              value={form.vendors}
              onChange={(event) => form.setVendors(event.target.value)}
              placeholder="arkesel"
            />
            <FieldDescription>
              Provider costs are recorded per vendor, so publication needs the
              carriers named — an unrestricted offer cannot be margin-checked
              against a vendor that has no rate yet.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${fieldId}-from`}>Effective from</FieldLabel>
            <Input
              id={`${fieldId}-from`}
              type="datetime-local"
              value={form.effectiveFrom}
              onChange={(event) => form.setEffectiveFrom(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${fieldId}-to`}>
              Effective to (blank = open-ended)
            </FieldLabel>
            <Input
              id={`${fieldId}-to`}
              type="datetime-local"
              value={form.effectiveTo}
              onChange={(event) => form.setEffectiveTo(event.target.value)}
            />
          </Field>
        </div>

        <MarginVerdict
          verdict={verdict?.preview ?? null}
          stale={stale}
          unitLabel={offer.unit_code}
          currency={form.currency}
        />

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={check}
            disabled={!form.valid || busy}
          >
            Check margin
          </Button>
          <Button type="button" onClick={save} disabled={!form.valid || busy}>
            {version ? "Save draft" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
