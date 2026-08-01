"use client";

import type { CommercialOfferChannelDto, PriceBookDto } from "@app/contracts";
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
import { createOffer, OfferError } from "@/lib/client/commercial-offers-api";

const CODE_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/;

/**
 * An offer's stable identity — catalog, code, name, and the channel whose natural unit it sells.
 * Terms are deliberately a separate step: the identity outlives every price it has ever carried, and
 * conflating the two is what makes a "price change" look like a new product.
 */
export function NewOfferDialog({
  open,
  onOpenChange,
  catalogs,
  channels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalogs: readonly PriceBookDto[];
  channels: readonly CommercialOfferChannelDto[];
}) {
  const router = useRouter();
  const fieldId = useId();
  const [catalogId, setCatalogId] = useState(catalogs[0]?.id ?? "");
  const [channelKey, setChannelKey] = useState(
    channels[0] ? `${channels[0].code}:${channels[0].unit_code}` : "",
  );
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const valid =
    catalogId.length > 0 &&
    channelKey.length > 0 &&
    CODE_PATTERN.test(code) &&
    name.trim().length > 0;

  async function submit() {
    const [channelCode, unitCode] = channelKey.split(":");
    if (!valid || !channelCode || !unitCode) return;
    setBusy(true);
    try {
      await createOffer({
        price_book_id: catalogId,
        code,
        name: name.trim(),
        description: description.trim(),
        channel_code: channelCode,
        unit_code: unitCode,
      });
      toast.success(`Offer "${name.trim()}" created. Add its terms next.`);
      onOpenChange(false);
      setCode("");
      setName("");
      setDescription("");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof OfferError
          ? error.message
          : "The offer could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New prepaid offer</DialogTitle>
          <DialogDescription>
            Nothing is sellable until a version of its terms is published.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor={`${fieldId}-catalog`}>Catalog</FieldLabel>
            <Select value={catalogId} onValueChange={setCatalogId}>
              <SelectTrigger id={`${fieldId}-catalog`}>
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
            <FieldDescription>
              Workspaces buy from the catalog they are assigned, or the default.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor={`${fieldId}-channel`}>
              Channel and unit
            </FieldLabel>
            <Select value={channelKey} onValueChange={setChannelKey}>
              <SelectTrigger id={`${fieldId}-channel`}>
                <SelectValue placeholder="Select a channel" />
              </SelectTrigger>
              <SelectContent>
                {channels.map((channel) => (
                  <SelectItem
                    key={`${channel.code}:${channel.unit_code}`}
                    value={`${channel.code}:${channel.unit_code}`}
                  >
                    {channel.display_name} — per {channel.unit_label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              Only active channels appear. SMS sells SEGMENTS, so a long message
              consumes more than one — say so in customer copy.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor={`${fieldId}-code`}>Code</FieldLabel>
            <Input
              id={`${fieldId}-code`}
              value={code}
              onChange={(event) => setCode(event.target.value.toLowerCase())}
              placeholder="starter-sms-200"
            />
            <FieldDescription>
              Starts with a letter, then 1–63 more: lowercase letters, digits,
              hyphens or underscores. Unique within the catalog, and permanent
              once purchases reference it.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor={`${fieldId}-name`}>Display name</FieldLabel>
            <Input
              id={`${fieldId}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Starter SMS"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor={`${fieldId}-description`}>
              Description
            </FieldLabel>
            <Input
              id={`${fieldId}-description`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="200 SMS segments for Ghana transactional traffic"
            />
          </Field>
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={!valid || busy}>
            Create offer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
