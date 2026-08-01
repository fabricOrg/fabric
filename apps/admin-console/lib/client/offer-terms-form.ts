"use client";

import {
  type CommercialOfferVersionDto,
  type CreateCommercialOfferVersionRequest,
  type Currency,
  MINOR_PER_MAJOR,
} from "@app/contracts";
import { useState } from "react";
import { parseAmountToMinor } from "@/lib/money";

/**
 * The state behind the offer-terms form, kept out of the dialog so the validation lives beside the
 * values it validates rather than being re-derived at each call site.
 *
 * Every money value is produced with integer math (`parseAmountToMinor`): staff type "3.00" and the
 * API receives exact minor units. A fixed total need not divide evenly by its units, so no per-unit
 * price is ever computed here — that number is informational and comes from the server's preview.
 */

/** Comma-separated eligibility input → the array the contract expects, blanks dropped. */
function toList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * ISO instant → the local value a `datetime-local` input accepts. Staff reason about an active period
 * in their own clock; `terms()` converts back, so the API only ever receives UTC.
 */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/**
 * Minor units → the display amount the input round-trips ("300" → "3.00"). Integer math only, and the
 * exponent comes from `MINOR_PER_MAJOR` rather than a hardcoded 100 so this stays the exact inverse of
 * `parseAmountToMinor` — a zero-decimal currency would otherwise break the round-trip in one direction.
 */
function minorToDisplay(minor: string, currency: Currency): string {
  const per = BigInt(MINOR_PER_MAJOR[currency]);
  const decimals = String(MINOR_PER_MAJOR[currency]).length - 1;
  const value = BigInt(minor);
  if (decimals === 0) return (value / per).toString();
  return `${value / per}.${(value % per).toString().padStart(decimals, "0")}`;
}

export interface OfferTermsForm {
  currency: Currency;
  setCurrency: (value: Currency) => void;
  units: string;
  setUnits: (value: string) => void;
  amount: string;
  setAmount: (value: string) => void;
  countries: string;
  setCountries: (value: string) => void;
  trafficClasses: string;
  setTrafficClasses: (value: string) => void;
  vendors: string;
  setVendors: (value: string) => void;
  minimumPacks: string;
  setMinimumPacks: (value: string) => void;
  maximumPacks: string;
  setMaximumPacks: (value: string) => void;
  effectiveFrom: string;
  setEffectiveFrom: (value: string) => void;
  effectiveTo: string;
  setEffectiveTo: (value: string) => void;
  valid: boolean;
  terms: () => CreateCommercialOfferVersionRequest;
  /**
   * Identity of the CURRENT terms. A margin verdict is only about the terms it was computed from, so
   * the caller compares this against the fingerprint it stored with the verdict — an edited form must
   * not keep displaying a "Publishable" badge earned by different numbers.
   */
  fingerprint: string;
}

export function useOfferTermsForm(
  version: CommercialOfferVersionDto | null,
): OfferTermsForm {
  const [currency, setCurrency] = useState<Currency>(
    (version?.currency as Currency) ?? "GHS",
  );
  const [units, setUnits] = useState(version?.paid_units ?? "");
  const [amount, setAmount] = useState(
    version
      ? minorToDisplay(version.total_price_minor, version.currency as Currency)
      : "",
  );
  const [countries, setCountries] = useState(
    version?.eligibility.destination_countries.join(", ") ?? "",
  );
  const [trafficClasses, setTrafficClasses] = useState(
    version?.eligibility.traffic_classes.join(", ") ?? "",
  );
  const [vendors, setVendors] = useState(
    version?.eligibility.provider_vendors.join(", ") ?? "",
  );
  const [minimumPacks, setMinimumPacks] = useState(
    String(version?.minimum_pack_count ?? 1),
  );
  const [maximumPacks, setMaximumPacks] = useState(
    version?.maximum_pack_count == null
      ? ""
      : String(version.maximum_pack_count),
  );
  // The active period is editable because a WINDOW is how two prices coexist. A published version's
  // window can never be shortened (0110 makes it immutable), so the successor is what has to move: give
  // the new draft a start after the incumbent ends, or retire the incumbent.
  const [effectiveFrom, setEffectiveFrom] = useState(
    toLocalInput(version?.effective_from ?? new Date().toISOString()),
  );
  const [effectiveTo, setEffectiveTo] = useState(
    version?.effective_to ? toLocalInput(version.effective_to) : "",
  );

  const totalMinor = parseAmountToMinor(amount, currency);
  const valid =
    totalMinor !== null &&
    totalMinor > 0n &&
    /^\d+$/.test(units) &&
    BigInt(units || "0") > 0n &&
    /^\d+$/.test(minimumPacks) &&
    Number(minimumPacks) > 0 &&
    (maximumPacks === "" ||
      (/^\d+$/.test(maximumPacks) &&
        Number(maximumPacks) >= Number(minimumPacks))) &&
    effectiveFrom.length > 0 &&
    (effectiveTo === "" || new Date(effectiveTo) > new Date(effectiveFrom));

  const currentTerms: CreateCommercialOfferVersionRequest = {
    currency,
    paid_units: units,
    bonus_units: "0",
    total_price_minor: (totalMinor ?? 0n).toString(),
    minimum_pack_count: Number(minimumPacks),
    maximum_pack_count: maximumPacks === "" ? null : Number(maximumPacks),
    eligibility: {
      destination_countries: toList(countries).map((code) =>
        code.toUpperCase(),
      ),
      traffic_classes: toList(trafficClasses),
      provider_vendors: toList(vendors),
      service_classes: [],
    },
    effective_from: effectiveFrom
      ? new Date(effectiveFrom).toISOString()
      : new Date().toISOString(),
    effective_to:
      effectiveTo === "" ? null : new Date(effectiveTo).toISOString(),
  };

  return {
    currency,
    setCurrency,
    units,
    setUnits,
    amount,
    setAmount,
    countries,
    setCountries,
    trafficClasses,
    setTrafficClasses,
    vendors,
    setVendors,
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
