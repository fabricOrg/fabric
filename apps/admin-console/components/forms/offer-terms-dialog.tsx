"use client";

import type {
  CommercialOfferChannelDto,
  CommercialOfferVersionDto,
  CommercialOfferWithVersions,
  CommercialRouteVocabulary,
  Currency,
} from "@app/contracts";
import { supportedEligibilityDimensions } from "@app/contracts";
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
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import { EligibilityChips } from "@/components/forms/eligibility-chips";
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
  const fieldId = useId();
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
            {version ? `Edit draft v${version.version}` : "New package terms"}
          </DialogTitle>
          <DialogDescription>
            {offer.name}. Add one or more channel credits, then set one price
            for the complete package.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {form.items.map((item, index) => {
            // Only offer the restrictions this channel's send path can actually match — anything
            // else would publish credits that can never be drawn against.
            const channelCode = item.channelKey.split(":")[0] ?? "";
            const routable = supportedEligibilityDimensions(
              channelCode,
            ).includes("destination_countries");
            return (
              <div
                key={item.key}
                className="grid gap-3 rounded-md border p-3 sm:grid-cols-2"
              >
                <div className="flex items-center justify-between sm:col-span-2">
                  <p className="text-sm font-medium">
                    Package item {index + 1}
                  </p>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove package item ${index + 1}`}
                    disabled={form.items.length === 1}
                    onClick={() => form.removeItem(item.key)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <Field>
                  <FieldLabel>Channel and unit</FieldLabel>
                  <Select
                    value={item.channelKey}
                    onValueChange={(channelKey) => {
                      // Drop restrictions the new channel cannot honour, so a hidden leftover value
                      // cannot fail validation on a field the author can no longer see.
                      const next = supportedEligibilityDimensions(
                        channelKey.split(":")[0] ?? "",
                      );
                      if (next.includes("destination_countries")) {
                        form.updateItem(item.key, { channelKey });
                        return;
                      }
                      form.updateItem(item.key, {
                        channelKey,
                        countries: "",
                        trafficClasses: "",
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a channel" />
                    </SelectTrigger>
                    <SelectContent>
                      {channels.map((channel) => (
                        <SelectItem
                          key={`${channel.code}:${channel.unit_code}`}
                          value={`${channel.code}:${channel.unit_code}`}
                          disabled={form.items.some(
                            (candidate) =>
                              candidate.key !== item.key &&
                              candidate.channelKey ===
                                `${channel.code}:${channel.unit_code}`,
                          )}
                        >
                          {channel.display_name} — per {channel.unit_label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>Included credits</FieldLabel>
                  <Input
                    inputMode="numeric"
                    value={item.units}
                    placeholder="20"
                    onChange={(event) =>
                      form.updateItem(item.key, { units: event.target.value })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel>Providers (required)</FieldLabel>
                  <EligibilityChips
                    value={item.vendors}
                    options={routeVocabulary.provider_vendors}
                    onChange={(vendors) =>
                      form.updateItem(item.key, { vendors })
                    }
                    anyLabel="None selected — publication will be refused."
                    emptyHint="No provider cost rates exist yet, so no offer can be margin-checked."
                  />
                  <FieldDescription>
                    Provider costs are recorded per vendor, so publication needs
                    the carriers named — an unrestricted offer cannot be
                    margin-checked against a vendor that has no rate yet.
                  </FieldDescription>
                </Field>
                {!routable && (
                  <FieldDescription className="sm:col-span-2">
                    {channelCode} sends carry no rated destination or traffic
                    class, so these credits are spendable on any {channelCode}{" "}
                    route.
                  </FieldDescription>
                )}
                {routable && (
                  <>
                    <Field>
                      <FieldLabel>Destinations</FieldLabel>
                      <EligibilityChips
                        value={item.countries}
                        options={routeVocabulary.destination_countries}
                        onChange={(countries) =>
                          form.updateItem(item.key, { countries })
                        }
                        anyLabel="Any priced destination"
                        emptyHint="No destination-specific rates — this offer covers every destination its providers price."
                      />
                    </Field>
                    <Field className="sm:col-span-2">
                      <FieldLabel>Traffic classes</FieldLabel>
                      <EligibilityChips
                        value={item.trafficClasses}
                        options={routeVocabulary.traffic_classes}
                        onChange={(trafficClasses) =>
                          form.updateItem(item.key, { trafficClasses })
                        }
                        anyLabel="Any priced traffic class"
                        emptyHint="No traffic-class-specific rates — this offer covers every class its providers price."
                      />
                    </Field>
                  </>
                )}
              </div>
            );
          })}
          <Button
            type="button"
            variant="outline"
            className="self-start"
            disabled={form.items.length >= channels.length}
            onClick={() => {
              const used = new Set(form.items.map((item) => item.channelKey));
              const next = channels.find(
                (channel) => !used.has(`${channel.code}:${channel.unit_code}`),
              );
              if (next) form.addItem(`${next.code}:${next.unit_code}`);
            }}
          >
            <Plus className="size-4" /> Add channel
          </Button>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`${fieldId}-amount`}>
                Package price
              </FieldLabel>
              <div className="flex gap-2">
                <Select
                  value={form.currency}
                  onValueChange={(value) => form.setCurrency(value as Currency)}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((currency) => (
                      <SelectItem key={currency} value={currency}>
                        {currency}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  id={`${fieldId}-amount`}
                  inputMode="decimal"
                  value={form.amount}
                  placeholder="50.00"
                  onChange={(event) => form.setAmount(event.target.value)}
                />
              </div>
            </Field>
            <Field>
              <FieldLabel>Credit validity (days)</FieldLabel>
              <Input
                inputMode="numeric"
                value={form.creditValidityDays}
                placeholder="Blank means never expires"
                onChange={(event) =>
                  form.setCreditValidityDays(event.target.value)
                }
              />
            </Field>
            <Field>
              <FieldLabel>Minimum packs</FieldLabel>
              <Input
                inputMode="numeric"
                value={form.minimumPacks}
                onChange={(event) => form.setMinimumPacks(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel>Maximum packs (blank = unlimited)</FieldLabel>
              <Input
                inputMode="numeric"
                value={form.maximumPacks}
                onChange={(event) => form.setMaximumPacks(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel>Available from</FieldLabel>
              <Input
                type="datetime-local"
                value={form.effectiveFrom}
                onChange={(event) => form.setEffectiveFrom(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel>Available until (optional)</FieldLabel>
              <Input
                type="datetime-local"
                value={form.effectiveTo}
                onChange={(event) => form.setEffectiveTo(event.target.value)}
              />
            </Field>
          </div>
        </div>

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
