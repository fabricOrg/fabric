import {
  currency,
  type OverviewActivity,
  type OverviewResponse,
  type OverviewTrafficPoint,
} from "@app/contracts";
import type { AppDb } from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { APP_DB } from "../db/db.module.js";

interface CountRow {
  sent: number;
  delivered: number;
  resolved: number;
}

interface BalanceRow {
  currency: string;
  balance_minor: string;
}

interface SpendRow {
  amount_minor: string;
}

@Injectable()
export class OverviewService {
  constructor(@Inject(APP_DB) private readonly db: AppDb) {}

  async get(
    tenantId: string,
    environmentId?: string | null,
  ): Promise<OverviewResponse> {
    const env = environmentId ?? null;
    return this.db.withTenant(tenantId, async (tx) => {
      const balances = (await tx`
        SELECT currency, balance_minor::text
        FROM ledger_accounts
        WHERE kind = 'customer' AND status = 'active'
        ORDER BY currency
        LIMIT 1`) as BalanceRow[];
      const primaryCurrency = currency.parse(balances[0]?.currency ?? "GHS");

      const [counts, spend, traffic, activity] = await Promise.all([
        tx`
          SELECT
            count(*)::int AS sent,
            count(*) FILTER (WHERE status = 'delivered')::int AS delivered,
            count(*) FILTER (
              WHERE status IN ('delivered', 'undelivered', 'failed', 'expired')
            )::int AS resolved
          FROM messages
          WHERE created_at >= (
            date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
          )
            AND (${env}::uuid IS NULL OR environment_id = ${env}::uuid)`,
        tx`
          SELECT COALESCE(sum(e.amount_minor), 0)::text AS amount_minor
          FROM ledger_entries e
          JOIN ledger_accounts a ON a.id = e.account_id
          WHERE a.kind = 'customer'
            AND a.currency = ${primaryCurrency}
            AND e.direction = 'debit'
            AND e.reason IN ('message_reserve', 'sms_reserve')
            AND e.created_at >= (
              date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
            )
            AND EXISTS (
              SELECT 1
              FROM ledger_transactions t
              WHERE t.tenant_id = e.tenant_id
                AND t.reference_id = e.reference_id
                AND t.type = 'sms_charge'
                AND t.status = 'committed'
            )`,
        tx`
          WITH days AS (
            SELECT generate_series(
              (date_trunc('day', now() AT TIME ZONE 'UTC') - interval '13 days')::date,
              (now() AT TIME ZONE 'UTC')::date,
              interval '1 day'
            )::date AS day
          )
          SELECT
            to_char(d.day, 'YYYY-MM-DD') AS date,
            count(m.id)::int AS sent,
            count(m.id) FILTER (WHERE m.status = 'delivered')::int AS delivered
          FROM days d
          LEFT JOIN messages m
            ON (m.created_at AT TIME ZONE 'UTC')::date = d.day
            AND (${env}::uuid IS NULL OR m.environment_id = ${env}::uuid)
          GROUP BY d.day
          ORDER BY d.day`,
        tx`
          WITH recent_messages AS (
            SELECT
              id::text,
              'message'::text AS kind,
              'Protected recipient'::text AS label,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at,
              status::text
            FROM messages
            WHERE (${env}::uuid IS NULL OR environment_id = ${env}::uuid)
            ORDER BY created_at DESC, id DESC
            LIMIT 6
          ),
          recent_topups AS (
            SELECT
              e.id::text,
              'topup'::text AS kind,
              'Wallet top-up'::text AS label,
              to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at,
              'completed'::text AS status
            FROM ledger_entries e
            JOIN ledger_accounts a ON a.id = e.account_id
            WHERE a.kind = 'customer'
              AND e.direction = 'credit'
              AND e.reason = 'topup'
            ORDER BY e.created_at DESC, e.id DESC
            LIMIT 6
          )
          SELECT * FROM (
            SELECT * FROM recent_messages
            UNION ALL
            SELECT * FROM recent_topups
          ) recent
          ORDER BY at DESC, id DESC
          LIMIT 6`,
      ]);

      return buildOverview({
        counts: (counts as unknown as CountRow[])[0],
        balance: balances[0],
        spend: (spend as unknown as SpendRow[])[0],
        traffic: traffic as unknown as OverviewTrafficPoint[],
        activity: activity as unknown as OverviewActivity[],
        primaryCurrency,
      });
    });
  }
}

function buildOverview(input: {
  counts: CountRow | undefined;
  balance: BalanceRow | undefined;
  spend: SpendRow | undefined;
  traffic: OverviewTrafficPoint[];
  activity: OverviewActivity[];
  primaryCurrency: "GHS" | "NGN" | "USD";
}): OverviewResponse {
  const resolved = input.counts?.resolved ?? 0;
  const delivered = input.counts?.delivered ?? 0;
  const spend = {
    currency: input.primaryCurrency,
    minor: input.spend?.amount_minor ?? "0",
  };
  return {
    messagesSent: input.counts?.sent ?? 0,
    deliveryRate: resolved === 0 ? 0 : delivered / resolved,
    spendThisMonth: spend,
    walletBalance: {
      currency: input.primaryCurrency,
      minor: input.balance?.balance_minor ?? "0",
    },
    traffic: input.traffic,
    spendByChannel: [{ channel: "sms", spend }],
    recentActivity: input.activity,
  };
}
