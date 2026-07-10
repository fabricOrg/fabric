import type { VerifyOverviewResponse } from "@app/contracts";
import { type AppDb, verifications } from "@app/db";
import { desc, eq, sql } from "drizzle-orm";

/**
 * Verify overview rollups (V2 dashboard surface), split from VerifyService for the file-length
 * guard. All tenant-scoped under RLS. "delivered" joins the OTP's message row — a verification
 * whose SMS the carrier confirmed; funnel: verified ≤ delivered ≤ sent.
 */
export async function verifyOverview(
  db: AppDb,
  tenantId: string,
): Promise<VerifyOverviewResponse> {
  return db.withTenantDrizzle(tenantId, async (tx) => {
    const recentRows = await tx
      .select()
      .from(verifications)
      .where(eq(verifications.tenantId, tenantId as never))
      .orderBy(desc(verifications.createdAt))
      .limit(20);

    const [funnel] = (await tx.execute(sql`
      SELECT
        count(*)::int AS sent,
        count(*) FILTER (
          WHERE m.status IN ('delivered')
        )::int AS delivered,
        count(*) FILTER (WHERE v.status = 'verified')::int AS verified
      FROM verifications v
      LEFT JOIN messages m ON m.id = v.message_id
    `)) as unknown as Array<{
      sent: number;
      delivered: number;
      verified: number;
    }>;

    const trendRows = (await tx.execute(sql`
      SELECT
        to_char(date_trunc('day', v.created_at), 'YYYY-MM-DD') AS date,
        count(*)::int AS attempts,
        count(*) FILTER (WHERE v.status = 'verified')::int AS verified
      FROM verifications v
      WHERE v.created_at >= now() - interval '14 days'
      GROUP BY 1 ORDER BY 1
    `)) as unknown as Array<{
      date: string;
      attempts: number;
      verified: number;
    }>;

    return {
      recent: recentRows.map((row) => ({
        id: row.id,
        msisdn: row.msisdnMasked,
        channel: "sms" as const,
        status: row.status,
        created_at: row.createdAt.toISOString(),
        verified_at: row.verifiedAt?.toISOString() ?? null,
      })),
      stats: {
        sent: funnel?.sent ?? 0,
        delivered: funnel?.delivered ?? 0,
        verified: funnel?.verified ?? 0,
      },
      trend: trendRows,
    };
  });
}
