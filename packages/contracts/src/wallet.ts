// Wallet + ledger public API shapes (F3.1). Balances are per-currency; the ledger is the customer-
// facing projection of the double-entry ledger (top-ups, sms charges, refunds, adjustments). zod-only.

import { z } from "zod";
import { currency, money } from "./money.js";

/** One wallet balance (a tenant may hold several currencies). */
export const walletBalance = z.object({
  balance: money,
  /** low-balance threshold for this currency (alert fires below it), if configured. */
  lowBalanceThreshold: money.optional(),
});
export type WalletBalance = z.infer<typeof walletBalance>;

export const ledgerEntryType = z.enum([
  "topup",
  "sms_charge",
  "refund",
  "adjustment",
]);
export type LedgerEntryType = z.infer<typeof ledgerEntryType>;

/** A customer-visible ledger line. `direction` avoids sign ambiguity; `runningBalance` is post-entry. */
export const ledgerEntry = z.object({
  id: z.string(),
  type: ledgerEntryType,
  direction: z.enum(["credit", "debit"]),
  amount: money,
  runningBalance: money,
  createdAt: z.string(),
  reference: z.string().optional(), // e.g. the message id for an sms_charge
});
export type LedgerEntry = z.infer<typeof ledgerEntry>;

/** POST /v1/wallet/topups — initiate a top-up (→ payment provider handoff). */
export const topupRequest = z.object({
  currency,
  minor: z.string().regex(/^\d+$/),
});
export type TopupRequest = z.infer<typeof topupRequest>;

/** GET /v1/wallet - balances and the customer-visible ledger in one dashboard read. */
export const walletSnapshot = z.object({
  /**
   * The one currency this workspace may be CHARGED in (`accounts.billing_currency`). Every charge
   * path rejects anything else — a top-up, an auto-top-up and a package purchase all raise
   * `billing_currency_mismatch` — so a caller that guesses offers a choice the server refuses.
   *
   * It is not derivable from `balances`: those are ledger accounts ordered alphabetically by
   * currency, so `balances[0]` is whichever sorts first, and it is empty on a workspace that has
   * never been funded — which is exactly when the first top-up picks a currency.
   */
  billing_currency: currency,
  balances: z.array(walletBalance),
  ledger: z.array(ledgerEntry),
  request_id: z.string(),
});
export type WalletSnapshot = z.infer<typeof walletSnapshot>;
