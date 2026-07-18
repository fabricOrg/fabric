import type { MessagingInsights } from "@app/contracts";
import type { AppDb } from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { APP_DB } from "../db/db.module.js";

/**
 * Messaging Insights (Messages → Insights). A REAL rollup aggregated from the tenant's `messages`
 * (RLS-scoped via withTenant), optionally narrowed to one environment. Replaces the former Twilio-
 * shaped mock. Read-only + fail-loud: a store error surfaces as the tab's error state, never fake data.
 */
@Injectable()
export class MessagingInsightsService {
  constructor(@Inject(APP_DB) private readonly db: AppDb) {}

  async summary(
    tenantId: string,
    environmentId?: string | null,
  ): Promise<MessagingInsights> {
    const env = environmentId ?? null;
    // RLS pins tenant_id; the env predicate is null-tolerant so the BFF token path (no environment)
    // rolls up the whole workspace, mirroring the message log.
    const [totals] = (await this.db.withTenant(
      tenantId,
      (tx) => tx`
        SELECT
          count(*)::int AS total_sent,
          count(*) FILTER (WHERE status = 'delivered')::int AS delivered,
          count(*) FILTER (WHERE status IN ('undelivered','failed','expired'))::int AS failed,
          COALESCE(avg(segments), 0)::float AS avg_segments
        FROM messages
        WHERE (${env}::uuid IS NULL OR environment_id = ${env}::uuid)`,
    )) as Array<{
      total_sent: number;
      delivered: number;
      failed: number;
      avg_segments: number;
    }>;

    const errorRows = (await this.db.withTenant(
      tenantId,
      (tx) => tx`
        SELECT error_code AS code, count(*)::int AS count
        FROM messages
        WHERE error_code IS NOT NULL
          AND (${env}::uuid IS NULL OR environment_id = ${env}::uuid)
        GROUP BY error_code
        ORDER BY count DESC
        LIMIT 10`,
    )) as Array<{ code: string; count: number }>;

    return {
      total_sent: totals?.total_sent ?? 0,
      delivered: totals?.delivered ?? 0,
      failed: totals?.failed ?? 0,
      avg_segments: totals?.avg_segments ?? 0,
      errors: errorRows.map((r) => ({
        code: r.code,
        description: describeErrorCode(r.code),
        count: r.count,
      })),
    };
  }
}

/** Human labels for the provider error codes our stack actually emits (sandbox + Arkesel live).
 *  Unknown codes fall back to the raw code — never a fabricated Twilio-style description. */
const ERROR_DESCRIPTIONS: Record<string, string> = {
  virtual_carrier_rejected: "Carrier rejected the message (virtual phone).",
  virtual_platform_fault: "Platform fault during delivery (virtual phone).",
  sandbox_recipient_rejected: "Sandbox recipient rejected the message.",
  sandbox_provider_failure: "Sandbox provider failure.",
};

function describeErrorCode(code: string): string {
  return ERROR_DESCRIPTIONS[code] ?? code;
}
