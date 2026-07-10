import type { AppDb } from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { APP_DB } from "../db/db.module.js";
import { invalidRequest } from "../http/api-error.js";

interface StatementRow {
  /** postgres-js text mode returns timestamptz as a string on this pool. */
  created_at: string;
  direction: "credit" | "debit";
  amount_minor: string;
  reason: string;
  reference_id: string | null;
}

/**
 * Statement export (B1, POSITIONING v2 "billing you can audit"). CSV over the CUSTOMER account's
 * ledger legs for a period: opening balance, every line with a reference, closing balance —
 * balanced BY CONSTRUCTION because the lines ARE the ledger. closing − opening ≡ sum(lines),
 * asserted in the integration test against real ledger data.
 */
@Injectable()
export class StatementService {
  constructor(@Inject(APP_DB) private readonly db: AppDb) {}

  async statementCsv(
    tenantId: string,
    opts: { from: Date; to: Date; currency: string },
  ): Promise<string> {
    if (opts.from >= opts.to) {
      throw invalidRequest(
        "invalid_period",
        "`from` must be before `to`.",
        "from",
      );
    }
    return this.db.withTenant(tenantId, async (tx) => {
      const openingRows = (await tx`
        SELECT COALESCE(SUM(CASE WHEN e.direction = 'credit' THEN e.amount_minor ELSE -e.amount_minor END), 0)::text AS opening
        FROM ledger_entries e
        JOIN ledger_accounts a ON a.id = e.account_id
        WHERE a.kind = 'customer' AND a.currency = ${opts.currency}
          AND e.created_at < ${opts.from.toISOString()}::timestamptz`) as Array<{
        opening: string;
      }>;
      const opening = BigInt(openingRows[0]?.opening ?? "0");

      const rows = (await tx`
        SELECT e.created_at, e.direction, e.amount_minor::text, e.reason, e.reference_id
        FROM ledger_entries e
        JOIN ledger_accounts a ON a.id = e.account_id
        WHERE a.kind = 'customer' AND a.currency = ${opts.currency}
          AND e.created_at >= ${opts.from.toISOString()}::timestamptz AND e.created_at < ${opts.to.toISOString()}::timestamptz
        ORDER BY e.created_at ASC, e.id ASC`) as unknown as StatementRow[];

      let running = opening;
      const lines: string[] = [
        "timestamp,type,direction,amount_minor,currency,reference,running_balance_minor",
        csvLine([
          opts.from.toISOString(),
          "opening_balance",
          "",
          "",
          opts.currency,
          "",
          opening.toString(),
        ]),
      ];
      for (const row of rows) {
        const amount = BigInt(row.amount_minor);
        running += row.direction === "credit" ? amount : -amount;
        lines.push(
          csvLine([
            new Date(row.created_at).toISOString(),
            row.reason,
            row.direction,
            row.amount_minor,
            opts.currency,
            row.reference_id ?? "",
            running.toString(),
          ]),
        );
      }
      lines.push(
        csvLine([
          opts.to.toISOString(),
          "closing_balance",
          "",
          "",
          opts.currency,
          "",
          running.toString(),
        ]),
      );
      return `${lines.join("\n")}\n`;
    });
  }
}

/** RFC-4180-enough: quote any field containing a comma/quote/newline. */
function csvLine(fields: string[]): string {
  return fields
    .map((field) =>
      /[",\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field,
    )
    .join(",");
}
