"use client";

import type {
  CommercialOfferChannelDto,
  CommercialRouteVocabulary,
  PriceBookDto,
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
import { PackageTermsFields } from "@/components/forms/package-terms-fields";
import { createPackage, OfferError } from "@/lib/client/commercial-offers-api";
import { useOfferTermsForm } from "@/lib/client/offer-terms-form";

const CODE_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/;

function codeFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** One workflow for the package identity and its first draft terms. */
export function NewOfferDialog({
  open,
  onOpenChange,
  catalogs,
  channels,
  routeVocabulary,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalogs: readonly PriceBookDto[];
  channels: readonly CommercialOfferChannelDto[];
  routeVocabulary: CommercialRouteVocabulary;
}) {
  const router = useRouter();
  const fieldId = useId();
  const [catalogId, setCatalogId] = useState(catalogs[0]?.id ?? "");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const defaultChannel = channels[0]
    ? `${channels[0].code}:${channels[0].unit_code}`
    : "";
  const form = useOfferTermsForm(null, defaultChannel);
  const valid =
    catalogId.length > 0 &&
    CODE_PATTERN.test(code) &&
    name.trim() &&
    form.valid;

  async function submit() {
    if (!valid) return;
    setBusy(true);
    try {
      await createPackage({
        offer: {
          price_book_id: catalogId,
          code,
          name: name.trim(),
          description: description.trim(),
        },
        version: form.terms(),
      });
      toast.success(`Package “${name.trim()}” created as a draft.`);
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof OfferError
          ? error.message
          : "The package could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New prepaid package</DialogTitle>
          <DialogDescription>
            Combine any supported channel credits under one price. The package
            remains a draft until a different admin publishes it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field className="sm:col-span-2">
            <FieldLabel>Catalog</FieldLabel>
            <Select value={catalogId} onValueChange={setCatalogId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a catalog" />
              </SelectTrigger>
              <SelectContent>
                {catalogs.map((catalog) => (
                  <SelectItem key={catalog.id} value={catalog.id}>
                    {catalog.name}
                    {catalog.is_default ? " (default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${fieldId}-name`}>Package name</FieldLabel>
            <Input
              id={`${fieldId}-name`}
              value={name}
              placeholder="Starter communications"
              onChange={(event) => {
                const nextName = event.target.value;
                setName(nextName);
                if (!code || code === codeFromName(name))
                  setCode(codeFromName(nextName));
              }}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${fieldId}-code`}>Code</FieldLabel>
            <Input
              id={`${fieldId}-code`}
              value={code}
              onChange={(event) => setCode(event.target.value.toLowerCase())}
            />
            <FieldDescription>
              Permanent identifier used in receipts and audit history.
            </FieldDescription>
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel>Description</FieldLabel>
            <Input
              value={description}
              placeholder="20 SMS segments and 20 email messages"
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
        </div>

        <PackageTermsFields
          form={form}
          channels={channels}
          routeVocabulary={routeVocabulary}
        />

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={!valid || busy}>
            Create package draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
