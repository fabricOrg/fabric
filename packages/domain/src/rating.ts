/**
 * Rating (F5.2) — PURE. Cost = segments × per-segment price for the destination. Thin-thread pricing
 * is a flat per-(currency) rate table; real destination/operator pricing is a fast-follow (F6.4
 * success-based SKU repricing is additive — see the reconciliation note). Money is minor units.
 */

/** Per-segment price in minor units, keyed by currency (thin-thread flat table). */
export type RateTable = Readonly<Record<string, bigint>>;

export const DEFAULT_RATES: RateTable = {
  GHS: 3n, // 0.03 GHS / segment (pesewas)
  NGN: 400n, // 4.00 NGN / segment (kobo)
  USD: 1n, // 0.01 USD / segment (cents)
};

export class UnknownCurrencyError extends Error {
  constructor(readonly currency: string) {
    super(`no per-segment rate configured for currency ${currency}`);
    this.name = "UnknownCurrencyError";
  }
}

/** cost_minor = segments × rate[currency]. Rejects an unpriced currency (never silently charge 0). */
export function rateSegments(
  segments: number,
  currency: string,
  rates: RateTable = DEFAULT_RATES,
): bigint {
  const per = rates[currency];
  if (per === undefined) throw new UnknownCurrencyError(currency);
  return BigInt(segments) * per;
}

// ---- Email flat per-send pricing (ADR-0010 §5) ---------------------------------------------------
// Email is priced FLAT per send, not by size — the 1/3/6 size tier is retired (at the 256 KiB cap the
// real data-cost delta is ≈ GHS 0.0004 while the old 6× tier over-charged by GHS 0.25). Deterministic:
// price depends only on the currency, so a preview and its subsequent send always agree. These are the
// compiled DEFAULTS; the resolved price comes from the account's price book (@app/api PricingService)
// which passes its own table in. A payload over the hard ceiling is a blocker upstream (previewEmail),
// never priced — the ceiling is a payload-size policy, not a pricing input.

/** Flat email price per send in minor units, keyed by currency. */
export const DEFAULT_EMAIL_BASE_RATES: RateTable = {
  GHS: 5n, // 0.05 GHS / email (pesewas)
  NGN: 500n, // 5.00 NGN (kobo)
  USD: 2n, // 0.02 USD (cents)
};

/** Hard ceiling on rendered email size. Over this is a blocker (previewEmail), never a price. */
export const EMAIL_MAX_BYTES = 262_144; // 256 KiB

/**
 * cost_minor = the flat per-send price for `currency`. Rejects an unpriced currency (never silently
 * charge zero — mirrors rateSegments). Size-independent; the ceiling is enforced upstream.
 */
export function rateEmailFlat(
  currency: string,
  rates: RateTable = DEFAULT_EMAIL_BASE_RATES,
): bigint {
  const per = rates[currency];
  if (per === undefined) throw new UnknownCurrencyError(currency);
  return per;
}

// ---- WhatsApp flat per-template-message pricing (ADR-0014 §3) ------------------------------------
// WhatsApp is priced FLAT per template message. Meta's own billing is CONVERSATION-based (a 24-hour
// window covering many messages), but that is our COST, not our unit of sale: a conversation's
// boundaries depend on the customer's replies, which is not something a caller can price against
// before sending. ADR-0014 §3 therefore supersedes ADR-0012's conversation guess — we sell one priced
// message and absorb the conversation-vs-message spread in the margin.

/** Flat WhatsApp price per template message in minor units, keyed by currency. */
export const DEFAULT_WHATSAPP_BASE_RATES: RateTable = {
  GHS: 12n, // 0.12 GHS / message (pesewas)
  NGN: 1_200n, // 12.00 NGN (kobo)
  USD: 5n, // 0.05 USD (cents)
};

/**
 * cost_minor = the flat per-message price for `currency`. Rejects an unpriced currency (never silently
 * charge zero — mirrors rateSegments / rateEmailFlat).
 */
export function rateWhatsappFlat(
  currency: string,
  rates: RateTable = DEFAULT_WHATSAPP_BASE_RATES,
): bigint {
  const per = rates[currency];
  if (per === undefined) throw new UnknownCurrencyError(currency);
  return per;
}
