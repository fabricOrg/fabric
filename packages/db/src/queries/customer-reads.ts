import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import type { TenantDrizzleTx } from "../client.js";
import { ledgerAccounts, ledgerEntries, messages } from "../schema/index.js";

export interface CustomerWalletRead {
  balances: Array<{ currency: string; balanceMinor: bigint }>;
  entries: Array<{
    id: string;
    direction: "credit" | "debit";
    amountMinor: bigint;
    reason: string;
    referenceId: string | null;
    createdAt: Date;
    currency: string;
  }>;
}

export interface CustomerMessageRead {
  id: string;
  senderId: string;
  status:
    | "queued"
    | "sending"
    | "accepted"
    | "sent"
    | "delivered"
    | "undelivered"
    | "failed"
    | "expired";
  encoding: "gsm7" | "ucs2";
  segments: number;
  costMinor: bigint;
  currency: string;
  providerSlug: string | null;
  deliveryMode: string;
  subjectId: string | null;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function readCustomerWallet(
  db: TenantDrizzleTx,
): Promise<CustomerWalletRead> {
  const balances = await db
    .select({
      currency: ledgerAccounts.currency,
      balanceMinor: ledgerAccounts.balanceMinor,
    })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.kind, "customer"),
        eq(ledgerAccounts.status, "active"),
      ),
    )
    .orderBy(ledgerAccounts.currency);

  const entries = await db
    .select({
      id: ledgerEntries.id,
      direction: ledgerEntries.direction,
      amountMinor: ledgerEntries.amountMinor,
      reason: ledgerEntries.reason,
      referenceId: ledgerEntries.referenceId,
      createdAt: ledgerEntries.createdAt,
      currency: ledgerAccounts.currency,
    })
    .from(ledgerEntries)
    .innerJoin(ledgerAccounts, eq(ledgerEntries.accountId, ledgerAccounts.id))
    .where(eq(ledgerAccounts.kind, "customer"))
    .orderBy(desc(ledgerEntries.createdAt), desc(ledgerEntries.id))
    .limit(100);

  return {
    balances: balances.map((row) => ({
      currency: row.currency,
      balanceMinor: BigInt(row.balanceMinor),
    })),
    entries: entries.map((row) => ({
      ...row,
      amountMinor: BigInt(row.amountMinor),
    })),
  };
}

const messageSelection = {
  id: messages.id,
  senderId: messages.senderId,
  status: messages.status,
  encoding: messages.encoding,
  segments: messages.segments,
  costMinor: messages.costMinor,
  currency: messages.currency,
  providerSlug: messages.providerSlug,
  deliveryMode: messages.deliveryMode,
  subjectId: messages.subjectId,
  errorCode: messages.errorCode,
  createdAt: messages.createdAt,
  updatedAt: messages.updatedAt,
};

/** Keyset page input: fetch rows strictly older than `before` on the (created_at, id) sort. */
export interface CustomerMessagePage {
  limit: number;
  before?: { createdAt: Date; id: string };
}

export async function listCustomerMessages(
  db: TenantDrizzleTx,
  environmentId: string | null | undefined,
  page: CustomerMessagePage,
): Promise<CustomerMessageRead[]> {
  // limit + 1: the extra row only signals "another page exists"; the caller slices it off.
  const rows = await db
    .select(messageSelection)
    .from(messages)
    .where(
      and(
        environmentId
          ? sql`${messages.environmentId} = ${environmentId}::uuid`
          : undefined,
        page.before
          ? or(
              lt(messages.createdAt, page.before.createdAt),
              and(
                eq(messages.createdAt, page.before.createdAt),
                lt(messages.id, page.before.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(page.limit + 1);
  return rows.map((row) => ({ ...row, costMinor: BigInt(row.costMinor) }));
}

export async function findCustomerMessage(
  db: TenantDrizzleTx,
  id: string,
  environmentId?: string | null,
): Promise<CustomerMessageRead | null> {
  const rows = await db
    .select(messageSelection)
    .from(messages)
    .where(
      environmentId
        ? and(
            eq(messages.id, id),
            sql`${messages.environmentId} = ${environmentId}::uuid`,
          )
        : eq(messages.id, id),
    )
    .limit(1);
  const row = rows[0];
  return row ? { ...row, costMinor: BigInt(row.costMinor) } : null;
}
