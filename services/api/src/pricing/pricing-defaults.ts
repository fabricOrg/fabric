import type { MinorUnits, NewPriceBookRate } from "@app/db";
import type { RateTable } from "@app/domain";
import type { BillableChannel } from "./effective-pricing.js";

/**
 * Row builders for the seeded default price book, split out of pricing.service.ts for the file-length
 * guard. Pure — they shape rows, they do not decide prices.
 */

/**
 * The unit each channel is sold in. Not cosmetic — `pricing_sell_rules` CHECKs the channel/basis pair,
 * so an unlisted channel would fail the insert rather than seed a wrong price.
 */
export const UNIT_BASIS: Record<
  BillableChannel,
  "segment" | "recipient" | "message"
> = {
  sms: "segment",
  email: "recipient",
  whatsapp: "message",
};

/** An assigned-but-channel-empty book must not reprice that channel to zero — fall to the default. */
export function pick(
  table: Record<string, bigint>,
  fallback: RateTable,
): RateTable {
  return Object.keys(table).length > 0 ? table : fallback;
}

export function versionedRatesFor(
  versionId: string,
  channel: BillableChannel,
  table: RateTable,
) {
  return Object.entries(table).map(([currency, unitPriceMinor]) => ({
    versionId,
    channel,
    currency,
    unitBasis: UNIT_BASIS[channel],
    unitPriceMinor: unitPriceMinor as MinorUnits,
  }));
}

export function ratesFor(
  bookId: string,
  channel: BillableChannel,
  table: RateTable,
): NewPriceBookRate[] {
  return Object.entries(table).map(([currency, unitPriceMinor]) => ({
    priceBookId: bookId,
    channel,
    currency,
    unitPriceMinor: unitPriceMinor as MinorUnits,
  }));
}
