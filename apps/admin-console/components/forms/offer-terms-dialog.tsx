"use client";

import type {
  CommercialOfferChannelDto,
  CommercialOfferVersionDto,
  CommercialOfferWithVersions,
  CommercialRouteVocabulary,
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
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { PackageTermsFields } from "@/components/forms/package-terms-fields";
import { MarginVerdict } from "@/components/offer-margin-verdict";
import {
  createVersion,
  OfferError,
  previewMargin,
  updateVersion,
} from "@/lib/client/commercial-offers-api";
import { useOfferTermsForm } from "@/lib/client/offer-terms-form";

export function OfferTermsDialog({
  offer,
  version,
  channels,
  routeVocabulary,
  open,
  onOpenChange,
}: {
  offer: CommercialOfferWithVersions;
  version: CommercialOfferVersionDto | null;
  channels: readonly CommercialOfferChannelDto[];
  routeVocabulary: CommercialRouteVocabulary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const defaultChannel = channels[0]
    ? `${channels[0].code}:${channels[0].unit_code}`
    : "";
  const form = useOfferTermsForm(version, defaultChannel);
  const [busy, setBusy] = useState(false);
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
        error instanceof OfferError ? error.message : "Margin check failed.",
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
      } else {
        await createVersion(offer.id, form.terms());
      }
      toast.success(
        version
          ? `Draft v${version.version} updated.`
          : "Package draft created.",
      );
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {version
              ? `Edit draft v${version.version}`
              : `New version of ${offer.name}`}
          </DialogTitle>
          <DialogDescription>
            {version
              ? "These terms are not yet published, so they can still change."
              : "A new version replaces what this package sells from its effective date. Published versions are never edited — the existing ones stay exactly as sold."}
          </DialogDescription>
        </DialogHeader>

        <PackageTermsFields
          form={form}
          channels={channels}
          routeVocabulary={routeVocabulary}
        />

        <MarginVerdict
          verdict={verdict?.preview ?? null}
          stale={stale}
          unitLabel="package"
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
