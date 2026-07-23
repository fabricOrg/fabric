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

// ---- Email size-tiered pricing (SDK-007 slice 2, ADR-0005 Amendment A1) --------------------------
// Email has no segments; it prices by RENDERED payload size in bytes. Deterministic — preview and send
// measure the same rendered output, so preview cost == send cost. These are SANDBOX PLACEHOLDER rates;
// the live path (SDK-009) re-tunes the numbers in this one pure function without touching the wallet
// plumbing. A payload over the hard ceiling is a blocker upstream (previewEmail), never silently priced.

/** Standard-email base price in minor units, keyed by currency. Size tiers multiply this. */
export const DEFAULT_EMAIL_BASE_RATES: RateTable = {
  GHS: 5n, // 0.05 GHS / standard email (pesewas)
  NGN: 500n, // 5.00 NGN (kobo)
  USD: 2n, // 0.02 USD (cents)
};

export type EmailSizeTier = "standard" | "large" | "xlarge";

// Half-open byte bands (rendered UTF-8 size) → price multiplier over the currency base. The last band's
// maxBytes is the hard ceiling; a larger payload is rejected upstream, not priced.
export const EMAIL_SIZE_TIERS: ReadonlyArray<{
  readonly maxBytes: number;
  readonly tier: EmailSizeTier;
  readonly multiplier: bigint;
}> = [
  { maxBytes: 51_200, tier: "standard", multiplier: 1n }, // ≤ 50 KiB
  { maxBytes: 153_600, tier: "large", multiplier: 3n }, // ≤ 150 KiB
  { maxBytes: 262_144, tier: "xlarge", multiplier: 6n }, // ≤ 256 KiB
];

/** Hard ceiling on rendered email size. Over this is a blocker (previewEmail), never a price. */
export const EMAIL_MAX_BYTES = 262_144; // 256 KiB

export class EmailPayloadTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(
      `rendered email payload ${bytes} bytes exceeds the ${EMAIL_MAX_BYTES}-byte ceiling`,
    );
    this.name = "EmailPayloadTooLargeError";
  }
}

/** The tier a rendered email of `bytes` falls into, or null if it exceeds the hard ceiling. */
export function emailSizeTier(bytes: number): EmailSizeTier | null {
  return EMAIL_SIZE_TIERS.find((t) => bytes <= t.maxBytes)?.tier ?? null;
}

/**
 * cost_minor = base[currency] × the tier multiplier for `bytes`. Rejects an unpriced currency and an
 * over-ceiling payload (never silently price either).
 */
export function rateEmailBySize(
  bytes: number,
  currency: string,
  base: RateTable = DEFAULT_EMAIL_BASE_RATES,
): bigint {
  const band = EMAIL_SIZE_TIERS.find((t) => bytes <= t.maxBytes);
  if (!band) throw new EmailPayloadTooLargeError(bytes);
  const per = base[currency];
  if (per === undefined) throw new UnknownCurrencyError(currency);
  return per * band.multiplier;
}
