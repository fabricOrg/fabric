import type { Transport } from "./transport.js";
import type { FabricResponse, Money, RequestOptions } from "./types.js";
import { ApiShapeError, enumField, record, stringField } from "./validation.js";

export interface WalletSnapshot {
  /**
   * The only currency this workspace may be CHARGED in. A top-up in any other is rejected with
   * `billing_currency_mismatch`, and it cannot be read off `balances`: those are ledger accounts, so
   * they are empty until the first top-up and still list the old currency after billing changes.
   */
  readonly billingCurrency: Money["currency"];
  readonly balances: ReadonlyArray<{
    readonly balance: Money;
    readonly lowBalanceThreshold?: Money;
  }>;
  readonly ledger: ReadonlyArray<{
    readonly id: string;
    readonly type: "topup" | "sms_charge" | "refund" | "adjustment";
    readonly direction: "credit" | "debit";
    readonly amount: Money;
    readonly runningBalance: Money;
    readonly createdAt: string;
    readonly reference?: string;
  }>;
}

export class WalletResource {
  constructor(private readonly transport: Transport) {}

  async retrieve(
    options?: RequestOptions,
  ): Promise<FabricResponse<WalletSnapshot>> {
    const response = await this.transport.request<Record<string, unknown>>({
      method: "GET",
      path: "/v1/wallet",
      ...(options ? { options } : {}),
    });
    if (
      !Array.isArray(response.data.balances) ||
      !Array.isArray(response.data.ledger)
    ) {
      throw new ApiShapeError("wallet");
    }
    return {
      ...response,
      data: {
        billingCurrency: enumField(
          response.data.billing_currency,
          ["GHS", "NGN", "USD"] as const,
          "billing_currency",
        ),
        balances: response.data.balances.map((value) =>
          parseBalance(record(value)),
        ),
        ledger: response.data.ledger.map((value) =>
          parseLedgerEntry(record(value)),
        ),
      },
    };
  }
}

function parseBalance(
  data: Record<string, unknown>,
): WalletSnapshot["balances"][number] {
  return {
    balance: parseMoney(record(data.balance), "balance"),
    ...(data.lowBalanceThreshold !== undefined
      ? {
          lowBalanceThreshold: parseMoney(
            record(data.lowBalanceThreshold),
            "lowBalanceThreshold",
          ),
        }
      : {}),
  };
}

function parseLedgerEntry(
  data: Record<string, unknown>,
): WalletSnapshot["ledger"][number] {
  return {
    id: stringField(data.id, "ledger.id"),
    type: enumField(
      data.type,
      ["topup", "sms_charge", "refund", "adjustment"] as const,
      "ledger.type",
    ),
    direction: enumField(
      data.direction,
      ["credit", "debit"] as const,
      "ledger.direction",
    ),
    amount: parseMoney(record(data.amount), "ledger.amount"),
    runningBalance: parseMoney(
      record(data.runningBalance),
      "ledger.runningBalance",
    ),
    createdAt: stringField(data.createdAt, "ledger.createdAt"),
    ...(data.reference !== undefined
      ? { reference: stringField(data.reference, "ledger.reference") }
      : {}),
  };
}

function parseMoney(data: Record<string, unknown>, name: string): Money {
  return {
    minor: stringField(data.minor, `${name}.minor`),
    currency: enumField(
      data.currency,
      ["GHS", "NGN", "USD"] as const,
      `${name}.currency`,
    ),
  };
}
