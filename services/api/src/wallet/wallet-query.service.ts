import {
  currency,
  type LedgerEntry,
  type LedgerEntryType,
  type WalletBalance,
} from "@app/contracts";
import { type AppDb, readCustomerWallet } from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { APP_DB } from "../db/db.module.js";

@Injectable()
export class WalletQueryService {
  constructor(@Inject(APP_DB) private readonly db: AppDb) {}

  async getSnapshot(tenantId: string): Promise<{
    balances: WalletBalance[];
    ledger: LedgerEntry[];
  }> {
    return this.db.withTenantDrizzle(tenantId, async (tx) => {
      const { balances, entries } = await readCustomerWallet(tx);
      const running = new Map<string, bigint>(
        balances.map((row) => [row.currency, row.balanceMinor]),
      );

      return {
        balances: balances.map((row) => ({
          balance: {
            currency: currency.parse(row.currency),
            minor: row.balanceMinor.toString(),
          },
        })),
        ledger: entries.map((row) => {
          const current = running.get(row.currency) ?? 0n;
          running.set(
            row.currency,
            row.direction === "credit"
              ? current - row.amountMinor
              : current + row.amountMinor,
          );
          return toLedgerEntry({ ...row, runningBalance: current });
        }),
      };
    });
  }
}

function toLedgerEntry(row: {
  id: string;
  direction: "credit" | "debit";
  amountMinor: bigint;
  reason: string;
  referenceId: string | null;
  createdAt: Date;
  currency: string;
  runningBalance: bigint;
}): LedgerEntry {
  const reason = row.reason;
  const type: LedgerEntryType =
    reason === "topup"
      ? "topup"
      : reason === "sms_refund"
        ? "refund"
        : reason === "adjustment"
          ? "adjustment"
          : "sms_charge";
  const cur = currency.parse(row.currency);
  return {
    id: row.id,
    type,
    direction: row.direction,
    amount: { currency: cur, minor: row.amountMinor.toString() },
    runningBalance: { currency: cur, minor: row.runningBalance.toString() },
    createdAt: row.createdAt.toISOString(),
    ...(row.referenceId ? { reference: row.referenceId } : {}),
  };
}
