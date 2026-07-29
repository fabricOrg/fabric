import type {
  SandboxAllowance,
  SandboxAllowancesResponse,
} from "@app/contracts";
import type { AppDb, TenantTx } from "@app/db";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { apiError } from "../http/api-error.js";
import {
  resolveSandboxAllowanceLimits,
  sandboxAllowanceDefaults,
} from "./sandbox-allowance-limits.js";

type Channel = "sms" | "email";
type Row = Record<string, unknown>;
interface UsageRow {
  usage_date: string;
  channel: Channel;
  used_units: string;
  daily_limit: string | null;
}

@Injectable()
export class SandboxAllowanceService {
  private readonly limits: Readonly<Record<Channel, bigint>>;

  constructor(@Optional() @Inject(ConfigService) config?: ConfigService) {
    this.limits = sandboxAllowanceDefaults(config);
  }

  async snapshot(
    db: AppDb,
    tenantId: string,
  ): Promise<Omit<SandboxAllowancesResponse, "request_id">> {
    return db.withTenant(tenantId, async (tx) => {
      const [account] = (await tx`
        SELECT settings FROM accounts
        WHERE id = current_setting('app.tenant_id')::uuid
        LIMIT 1`) as Array<{ settings: unknown }>;
      const limits = resolveSandboxAllowanceLimits(
        account?.settings,
        this.limits,
      );
      const rows = (await tx`
        SELECT
          (now() AT TIME ZONE 'UTC')::date::text AS usage_date,
          channels.channel,
          COALESCE(b.used_units, 0)::text AS used_units,
          b.daily_limit::text
        FROM (VALUES ('sms'::text), ('email'::text)) AS channels(channel)
        LEFT JOIN sandbox_usage_buckets b
          ON b.tenant_id = current_setting('app.tenant_id')::uuid
          AND b.usage_date = (now() AT TIME ZONE 'UTC')::date
          AND b.channel = channels.channel
        ORDER BY channels.channel DESC`) as UsageRow[];
      const date = rows[0]?.usage_date ?? utcDate(new Date());
      return {
        date,
        reset_at: nextUtcMidnight(date),
        allowances: rows.map((row) => this.allowance(row, limits)),
      };
    });
  }

  /**
   * Consume once per message reference. Claiming the event first makes concurrent retries charge
   * the shared workspace bucket exactly once.
   */
  async consume(
    tx: TenantTx,
    input: {
      channel: Channel;
      units: bigint;
      referenceId: string;
      applicationId?: string | null;
      environmentId?: string | null;
    },
  ): Promise<void> {
    if (input.units <= 0n) {
      throw new Error("Sandbox allowance units must be positive.");
    }
    const claimed = (await tx`
      INSERT INTO sandbox_usage_events (
        tenant_id, application_id, environment_id, usage_date, channel, reference_id, units
      ) VALUES (
        current_setting('app.tenant_id')::uuid, ${input.applicationId ?? null},
        ${input.environmentId ?? null}, (now() AT TIME ZONE 'UTC')::date,
        ${input.channel}, ${input.referenceId}, ${input.units.toString()}::bigint
      )
      ON CONFLICT (tenant_id, channel, reference_id) DO NOTHING
      RETURNING usage_date`) as Row[];
    if (!claimed[0]) return;

    const [account] = (await tx`
      SELECT settings FROM accounts
      WHERE id = current_setting('app.tenant_id')::uuid
      LIMIT 1`) as Array<{ settings: unknown }>;
    const limit = resolveSandboxAllowanceLimits(account?.settings, this.limits)[
      input.channel
    ];
    const buckets = (await tx`
      INSERT INTO sandbox_usage_buckets (
        tenant_id, usage_date, channel, used_units, daily_limit
      )
      SELECT
        current_setting('app.tenant_id')::uuid,
        (now() AT TIME ZONE 'UTC')::date, ${input.channel},
        ${input.units.toString()}::bigint, ${limit.toString()}::bigint
      WHERE ${input.units.toString()}::bigint <= ${limit.toString()}::bigint
      ON CONFLICT (tenant_id, usage_date, channel) DO UPDATE
      SET used_units = sandbox_usage_buckets.used_units + EXCLUDED.used_units,
          updated_at = now()
      WHERE sandbox_usage_buckets.used_units + EXCLUDED.used_units
        <= sandbox_usage_buckets.daily_limit
      RETURNING usage_date`) as Row[];
    if (buckets[0]) return;

    const [current] = (await tx`
      SELECT (now() AT TIME ZONE 'UTC')::date AS usage_date`) as Row[];
    throw apiError({
      type: "rate_limit_error",
      code: "sandbox_daily_limit_exceeded",
      message: `The sandbox ${input.channel} daily allowance is exhausted. It resets at ${nextUtcMidnight(String(current?.usage_date))}.`,
      status: 429,
    });
  }

  private allowance(
    row: UsageRow,
    limits: Readonly<Record<Channel, bigint>>,
  ): SandboxAllowance {
    const limit = row.daily_limit
      ? BigInt(row.daily_limit)
      : limits[row.channel];
    const used = BigInt(row.used_units);
    return {
      channel: row.channel,
      unit: row.channel === "sms" ? "segment" : "message",
      used: used.toString(),
      limit: limit.toString(),
      remaining: (limit - used).toString(),
    };
  }
}

function nextUtcMidnight(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return "the next UTC day";
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString();
}

function utcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
