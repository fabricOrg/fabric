"use client";

import type {
  CommercialOfferChannelDto,
  CommercialRouteVocabulary,
  Currency,
} from "@app/contracts";
import {
  supportedEligibilityDimensions,
  vocabularyForChannel,
} from "@app/contracts";
import { Button } from "@app/ui/components/ui/button";
import { DateTimePicker } from "@app/ui/components/ui/date-time-picker";
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
import { CreditExpirySelect } from "@/components/forms/credit-expiry-select";
import { EligibilityChips } from "@/components/forms/eligibility-chips";
import {
  toLocalInput,
  type useOfferTermsForm,
} from "@/lib/client/offer-terms-form";

const CURRENCIES: readonly Currency[] = ["GHS", "NGN", "USD"];

/**
 * The commercial terms of a package — shared verbatim by "New package" and "New/edit version".
 *
 * These were two hand-maintained copies of the same fields, which is how one ended up with
 * free-text eligibility and no availability dates while the other had both. One component means a
 * change to how a package is priced cannot land on only half the surface.
 */
export function PackageTermsFields({
  form,
  channels,
  routeVocabulary,
}: {
  form: ReturnType<typeof useOfferTermsForm>;
  channels: readonly CommercialOfferChannelDto[];
  routeVocabulary: CommercialRouteVocabulary;
}) {
  return (
    <>
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">Included channel credits</p>
        {form.items.map((item, index) => {
          const channelCode = item.channelKey.split(":")[0] ?? "";
          const channelVocabulary = vocabularyForChannel(
            routeVocabulary,
            channelCode,
          );
          // Only the restrictions this channel's send path can match; see CHANNEL_SUPPORTED_ELIGIBILITY.
          const routable = supportedEligibilityDimensions(channelCode).includes(
            "destination_countries",
          );
          return (
            <div
              key={item.key}
              className="grid gap-3 rounded-md border p-3 sm:grid-cols-[1fr_1fr_auto]"
            >
              <Field>
                <FieldLabel>Channel and unit</FieldLabel>
                <Select
                  value={item.channelKey}
                  onValueChange={(channelKey) =>
                    form.updateItem(item.key, { channelKey })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {channels.map((channel) => {
                      const value = `${channel.code}:${channel.unit_code}`;
                      return (
                        <SelectItem
                          key={value}
                          value={value}
                          disabled={form.items.some(
                            (candidate) =>
                              candidate.key !== item.key &&
                              candidate.channelKey === value,
                          )}
                        >
                          {channel.display_name} — per {channel.unit_label}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Credits per pack</FieldLabel>
                <Input
                  inputMode="numeric"
                  value={item.units}
                  placeholder="20"
                  onChange={(event) =>
                    form.updateItem(item.key, { units: event.target.value })
                  }
                />
              </Field>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="self-end"
                aria-label={`Remove package item ${index + 1}`}
                disabled={form.items.length === 1}
                onClick={() => form.removeItem(item.key)}
              >
                <Trash2 className="size-4" />
              </Button>
              <Field>
                <FieldLabel>Providers (required)</FieldLabel>
                <EligibilityChips
                  value={item.vendors}
                  options={channelVocabulary.provider_vendors}
                  onChange={(vendors) => form.updateItem(item.key, { vendors })}
                  anyLabel="None selected — publication will be refused."
                  emptyHint="No provider cost rates exist yet, so no package can be margin-checked."
                />
              </Field>
              {routable && (
                <>
                  <Field>
                    <FieldLabel>Traffic classes</FieldLabel>
                    <EligibilityChips
                      value={item.trafficClasses}
                      options={channelVocabulary.traffic_classes}
                      onChange={(trafficClasses) =>
                        form.updateItem(item.key, { trafficClasses })
                      }
                      anyLabel="Any priced traffic class"
                      emptyHint="No traffic-class-specific rates."
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Destinations</FieldLabel>
                    <EligibilityChips
                      value={item.countries}
                      options={channelVocabulary.destination_countries}
                      onChange={(countries) =>
                        form.updateItem(item.key, { countries })
                      }
                      anyLabel="Any priced destination"
                      emptyHint="No destination-specific rates."
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
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel>Package price</FieldLabel>
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
              inputMode="decimal"
              value={form.amount}
              placeholder="50.00"
              onChange={(event) => form.setAmount(event.target.value)}
            />
          </div>
        </Field>
        <Field>
          <FieldLabel>Credit expiry</FieldLabel>
          <CreditExpirySelect
            value={form.creditValidityDays}
            onChange={form.setCreditValidityDays}
          />
          <FieldDescription>
            Customers see this before they buy, and unspent credits are
            recognised as breakage once they lapse.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Available from</FieldLabel>
          <DateTimePicker
            value={
              form.effectiveFrom ? new Date(form.effectiveFrom) : undefined
            }
            onChange={(next) =>
              form.setEffectiveFrom(
                next ? toLocalInput(next.toISOString()) : "",
              )
            }
          />
        </Field>
        <Field>
          <FieldLabel>Available until (optional)</FieldLabel>
          <DateTimePicker
            value={form.effectiveTo ? new Date(form.effectiveTo) : undefined}
            onChange={(next) =>
              form.setEffectiveTo(next ? toLocalInput(next.toISOString()) : "")
            }
          />
          <FieldDescription>
            Leave blank to sell it until the package is retired.
          </FieldDescription>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
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
      </div>
    </>
  );
}
