// Money on the wire — F-money convention. Amounts are MINOR units (pesewas/kobo/cents) and exact:
// bigint doesn't survive JSON, so `minor` travels as a decimal-integer STRING. Never a float, never a
// bare number the UI might round. Consumers parse `BigInt(minor)` for math and format per currency.

import { z } from "zod";

/** ISO-4217 alpha-3, enabled set for the thin thread (control-plane-configurable later). */
export const currency = z.enum(["GHS", "NGN", "USD"]);
export type Currency = z.infer<typeof currency>;

/** An exact money amount. `minor` = integer minor units as a string (e.g. "120403" = GHS 1,204.03). */
export const money = z.object({
  currency,
  minor: z.string().regex(/^-?\d+$/, "minor must be an integer string"),
});
export type Money = z.infer<typeof money>;

/** Minor units per major, per enabled currency (all 2-decimal today). */
export const MINOR_PER_MAJOR: Readonly<Record<Currency, number>> = {
  GHS: 100,
  NGN: 100,
  USD: 100,
};

/** Build a Money from a bigint minor value. */
export function toMoney(minor: bigint, cur: Currency): Money {
  return { currency: cur, minor: minor.toString() };
}
