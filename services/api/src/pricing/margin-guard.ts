import { marginSatisfied, minimumSellPriceMinor } from "@app/domain";
import { sql } from "drizzle-orm";
import { invalidRequest } from "../http/api-error.js";

/** A sell price about to be written, in the vocabulary the caller already has. */
export interface SellRateCandidate {
  readonly channel: string;
  readonly currency: string;
  readonly unitPriceMinor: bigint;
}

interface CostRow {
  channel: string;
  currency: string;
  numerator_minor: string;
  denominator: string;
  provider_vendor: string;
  destination_country: string | null;
  traffic_class: string | null;
}

type Executor = {
  execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
};

/**
 * The WORST currently-active cost per channel+currency.
 *
 * Worst, not "the one that would be picked": a cost row may be scoped by destination country and
 * traffic class, so several can apply to the same channel and the runtime chooses per send. A book's
 * sell rules are always wildcard, so the price has to cover the most expensive row it could ever meet
 * — a cheaper scoped rate passing is not evidence the rate card is sellable.
 *
 * "Active" is spelled exactly as `EffectivePricingService.quote` spells it, INCLUDING a future
 * `effective_to`. That row is still the live cost until it lapses, and reading `effective_to IS NULL`
 * instead dropped it: scheduling a rate change (publish sets the outgoing row's `effective_to` to the
 * new start) left a window where this guard saw no cost at all and waved any price through, while the
 * runtime still priced against the old one. The guard and the quote disagreeing about "active" is the
 * same defect this whole change exists to prevent.
 */
async function worstActiveCosts(db: Executor): Promise<Map<string, CostRow>> {
  const rows = (await db.execute(sql`
    SELECT DISTINCT ON (channel, currency)
      channel, currency, numerator_minor, denominator, provider_vendor,
      destination_country, traffic_class
    FROM provider_cost_rates
    WHERE effective_from <= now()
      AND (effective_to IS NULL OR effective_to > now())
    ORDER BY channel, currency,
      (numerator_minor::numeric / denominator::numeric) DESC`)) as CostRow[];
  return new Map(rows.map((row) => [`${row.channel}:${row.currency}`, row]));
}

/** Ceil, so a per-unit cost is never displayed as LESS than it is (1150/100 is 11.5, not 11). */
function perUnitMinor(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

/** "sms · GH · promotional" — which row is blocking, when several share a channel and currency. */
function scopeOf(cost: CostRow): string {
  return [
    cost.channel,
    cost.destination_country ?? "any destination",
    cost.traffic_class ?? "any class",
  ].join(" · ");
}

function money(minor: bigint, currency: string): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const major = abs / 100n;
  const cents = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${currency} ${major}.${cents}`;
}

/**
 * Refuse a rate card the send path could never sell on.
 *
 * Before this, a below-cost price saved cleanly and failed forever at send time with
 * "WhatsApp sending is unavailable" — the operator who set the price got no signal, and the person
 * who found out was a customer. The check runs against the SAME rule the quote uses, so anything that
 * saves here prices there.
 *
 * A channel+currency with no active cost row is NOT rejected: costs are published independently and
 * often later, and refusing to price ahead of a cost would make the two writes order-dependent. That
 * gap is already fail-closed at send time (`buildEffectiveQuote` throws on a missing cost), so the
 * money is safe either way — this guard exists for the case where both exist and disagree.
 */
export async function assertSellRatesCoverCost(
  db: Executor,
  rates: readonly SellRateCandidate[],
  minimumMarginBps: number,
): Promise<void> {
  if (rates.length === 0) return;
  const costs = await worstActiveCosts(db);
  for (const rate of rates) {
    const cost = costs.get(`${rate.channel}:${rate.currency}`);
    if (!cost) continue;
    const providerCostNumerator = BigInt(cost.numerator_minor);
    const providerCostDenominator = BigInt(cost.denominator);
    if (providerCostDenominator <= 0n) continue;
    if (
      marginSatisfied({
        totalPriceMinor: rate.unitPriceMinor,
        providerCostNumerator,
        providerCostDenominator,
        minimumMarginBps,
      })
    ) {
      continue;
    }
    const floor = minimumSellPriceMinor({
      providerCostNumerator,
      providerCostDenominator,
      minimumMarginBps,
    });
    const costText = money(
      perUnitMinor(providerCostNumerator, providerCostDenominator),
      rate.currency,
    );
    const advice =
      floor === null
        ? "A 100% margin floor cannot be satisfied by any price — lower the floor."
        : `Charge at least ${money(floor, rate.currency)}, or lower the provider cost first.`;
    throw invalidRequest(
      "pricing_margin_violation",
      `${rate.channel} in ${rate.currency} is priced at ${money(rate.unitPriceMinor, rate.currency)}, ` +
        `below the ${minimumMarginBps / 100}% margin floor over the ${cost.provider_vendor} cost of ` +
        `${costText} (${scopeOf(cost)}). ${advice}`,
      "rates",
    );
  }
}

/**
 * The mirror of the above, for the other write that can create the same inversion: publishing a
 * provider cost ABOVE prices that are already live. Names every book it would break, because fixing
 * one and rediscovering the next on the following attempt is the same outage in instalments.
 */
export async function assertCostCoveredBySellRates(
  db: Executor,
  cost: {
    readonly channel: string;
    readonly currency: string;
    readonly numeratorMinor: bigint;
    readonly denominator: bigint;
    readonly providerVendor: string;
  },
): Promise<void> {
  if (cost.denominator <= 0n) return;
  const rows = (await db.execute(sql`
    SELECT b.name AS book, r.unit_price_minor, v.minimum_margin_bps
    FROM pricing_sell_rules r
    JOIN price_book_versions v ON v.id = r.version_id
    JOIN price_books b ON b.id = v.price_book_id
    WHERE v.status = 'published'
      AND r.channel = ${cost.channel}
      AND r.currency = ${cost.currency}
    ORDER BY b.name`)) as Array<{
    book: string;
    unit_price_minor: string;
    minimum_margin_bps: number;
  }>;

  const broken = rows.filter(
    (row) =>
      !marginSatisfied({
        totalPriceMinor: BigInt(row.unit_price_minor),
        providerCostNumerator: cost.numeratorMinor,
        providerCostDenominator: cost.denominator,
        minimumMarginBps: row.minimum_margin_bps,
      }),
  );
  if (broken.length === 0) return;

  const names = broken.map((row) => `"${row.book}"`).join(", ");
  throw invalidRequest(
    "pricing_margin_violation",
    `A ${cost.providerVendor} cost of ${money(perUnitMinor(cost.numeratorMinor, cost.denominator), cost.currency)} ` +
      `per ${cost.channel} would put ${broken.length === 1 ? "this book" : "these books"} below their margin floor: ${names}. ` +
      `Raise the ${cost.channel} price in ${cost.currency} first, then publish the cost.`,
    "numerator_minor",
  );
}
