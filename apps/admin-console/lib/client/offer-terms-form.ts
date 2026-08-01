"use client";

import {
  type CommercialOfferVersionDto,
  type CreateCommercialOfferVersionRequest,
  type Currency,
  MINOR_PER_MAJOR,
} from "@app/contracts";
import { useState } from "react";
import { parseAmountToMinor } from "@/lib/money";

export interface OfferItemFormValue {
  key: string;
  channelKey: string;
  units: string;
  countries: string;
  trafficClasses: string;
  vendors: string;
}

function toList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function minorToDisplay(minor: string, currency: Currency): string {
  const per = BigInt(MINOR_PER_MAJOR[currency]);
  const decimals = String(MINOR_PER_MAJOR[currency]).length - 1;
  const value = BigInt(minor);
  if (decimals === 0) return (value / per).toString();
  return `${value / per}.${(value % per).toString().padStart(decimals, "0")}`;
}

function initialItems(
  version: CommercialOfferVersionDto | null,
  defaultChannelKey: string,
): OfferItemFormValue[] {
  if (!version) {
    return [
      {
        key: crypto.randomUUID(),
        channelKey: defaultChannelKey,
        units: "",
        countries: "",
        trafficClasses: "",
        vendors: "",
      },
    ];
  }
  return version.items.map((item) => ({
    key: item.id,
    channelKey: `${item.channel_code}:${item.unit_code}`,
    units: item.paid_units,
    countries: item.eligibility.destination_countries.join(", "),
    trafficClasses: item.eligibility.traffic_classes.join(", "),
    vendors: item.eligibility.provider_vendors.join(", "),
  }));
}

export function useOfferTermsForm(
  version: CommercialOfferVersionDto | null,
  defaultChannelKey: string,
) {
  const [currency, setCurrency] = useState<Currency>(
    version?.currency ?? "GHS",
  );
  const [items, setItems] = useState(() =>
    initialItems(version, defaultChannelKey),
  );
  const [amount, setAmount] = useState(
    version ? minorToDisplay(version.total_price_minor, version.currency) : "",
  );
  const [creditValidityDays, setCreditValidityDays] = useState(
    version?.credit_validity_days ? String(version.credit_validity_days) : "",
  );
  const [minimumPacks, setMinimumPacks] = useState(
    String(version?.minimum_pack_count ?? 1),
  );
  const [maximumPacks, setMaximumPacks] = useState(
    version?.maximum_pack_count == null
      ? ""
      : String(version.maximum_pack_count),
  );
  const [effectiveFrom, setEffectiveFrom] = useState(
    toLocalInput(version?.effective_from ?? new Date().toISOString()),
  );
  const [effectiveTo, setEffectiveTo] = useState(
    version?.effective_to ? toLocalInput(version.effective_to) : "",
  );

  const totalMinor = parseAmountToMinor(amount, currency);
  const channelKeys = items.map((item) => item.channelKey);
  const valid =
    items.length > 0 &&
    channelKeys.every(Boolean) &&
    new Set(channelKeys).size === channelKeys.length &&
    items.every(
      (item) => /^\d+$/.test(item.units) && BigInt(item.units) > 0n,
    ) &&
    totalMinor !== null &&
    totalMinor > 0n &&
    (creditValidityDays === "" ||
      (/^\d+$/.test(creditValidityDays) && Number(creditValidityDays) > 0)) &&
    /^\d+$/.test(minimumPacks) &&
    Number(minimumPacks) > 0 &&
    (maximumPacks === "" ||
      (/^\d+$/.test(maximumPacks) &&
        Number(maximumPacks) >= Number(minimumPacks))) &&
    effectiveFrom.length > 0 &&
    (effectiveTo === "" || new Date(effectiveTo) > new Date(effectiveFrom));

  const currentTerms: CreateCommercialOfferVersionRequest = {
    currency,
    items: items.map((item) => {
      const [channelCode = "", unitCode = ""] = item.channelKey.split(":");
      return {
        channel_code: channelCode,
        unit_code: unitCode,
        paid_units: item.units,
        bonus_units: "0",
        eligibility: {
          destination_countries: toList(item.countries).map((code) =>
            code.toUpperCase(),
          ),
          traffic_classes: toList(item.trafficClasses),
          provider_vendors: toList(item.vendors),
          service_classes: [],
        },
      };
    }),
    total_price_minor: (totalMinor ?? 0n).toString(),
    credit_validity_days:
      creditValidityDays === "" ? null : Number(creditValidityDays),
    minimum_pack_count: Number(minimumPacks),
    maximum_pack_count: maximumPacks === "" ? null : Number(maximumPacks),
    effective_from: effectiveFrom
      ? new Date(effectiveFrom).toISOString()
      : new Date().toISOString(),
    effective_to: effectiveTo ? new Date(effectiveTo).toISOString() : null,
  };

  return {
    currency,
    setCurrency,
    items,
    updateItem: (key: string, patch: Partial<OfferItemFormValue>) =>
      setItems((current) =>
        current.map((item) =>
          item.key === key ? { ...item, ...patch } : item,
        ),
      ),
    addItem: (channelKey: string) =>
      setItems((current) => [
        ...current,
        {
          key: crypto.randomUUID(),
          channelKey,
          units: "",
          countries: "",
          trafficClasses: "",
          vendors: "",
        },
      ]),
    removeItem: (key: string) =>
      setItems((current) => current.filter((item) => item.key !== key)),
    amount,
    setAmount,
    creditValidityDays,
    setCreditValidityDays,
    minimumPacks,
    setMinimumPacks,
    maximumPacks,
    setMaximumPacks,
    effectiveFrom,
    setEffectiveFrom,
    effectiveTo,
    setEffectiveTo,
    valid,
    terms: () => currentTerms,
    fingerprint: JSON.stringify(currentTerms),
  };
}
