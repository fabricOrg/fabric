// Exact money formatting for the UI. Input is the F-money shape (minor units as a string); we parse
// BigInt and split whole/fraction with integer math — NEVER float — so "GHS 1,204.03" is never a
// rounding artifact. Grouping via Intl; the currency CODE is shown (not a glyph) per the design spec.

import { type Currency, MINOR_PER_MAJOR, type Money } from "@app/contracts";

const groupers: Partial<Record<Currency, Intl.NumberFormat>> = {};

function grouper(cur: Currency): Intl.NumberFormat {
  const cached = groupers[cur];
  if (cached) return cached;
  const made = new Intl.NumberFormat("en-US", { useGrouping: true });
  groupers[cur] = made;
  return made;
}

/** "GHS 1,204.03" — exact, code-prefixed, negatives as "-GHS 5.00". */
export function formatMoney(m: Money): string {
  const per = MINOR_PER_MAJOR[m.currency];
  const decimals = String(per).length - 1;
  const raw = BigInt(m.minor);
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const perBig = BigInt(per);
  const whole = abs / perBig;
  const frac = (abs % perBig).toString().padStart(decimals, "0");
  const wholeStr = grouper(m.currency).format(whole);
  return `${negative ? "-" : ""}${m.currency} ${wholeStr}.${frac}`;
}

/** Signed display for ledger rows: credit "+GHS 50.00", debit "-GHS 0.03". */
export function formatSigned(m: Money, direction: "credit" | "debit"): string {
  const base = formatMoney({ ...m, minor: m.minor.replace(/^-/, "") });
  return `${direction === "credit" ? "+" : "-"}${base}`;
}
