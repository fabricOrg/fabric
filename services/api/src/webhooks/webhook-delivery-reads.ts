import type { WebhookDeliveryDto } from "@app/contracts";
import {
  type AppDb,
  type EnvironmentId,
  outboxEvents,
  type TenantId,
  webhookDeliveries,
} from "@app/db";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { encodeCursor, type PageInput } from "../http/cursor.js";
import { toDeliveryDto } from "./webhook-dto.js";

/** Cursor-paginated per-endpoint delivery history (split from webhooks.service for file length). */
export async function listEndpointDeliveries(
  db: AppDb,
  tenantId: string,
  endpointId: string,
  state: "pending" | "delivering" | "delivered" | "dead" | undefined,
  page: PageInput,
  environmentId?: string,
): Promise<{ deliveries: WebhookDeliveryDto[]; next_cursor: string | null }> {
  return db.withTenantDrizzle(tenantId, async (tx) => {
    // The cursor timestamp travels as µs-precise text (cursorTs) — a JS Date would truncate to
    // ms, breaking both the < comparison and the id tiebreak for same-transaction rows.
    const rows = await tx
      .select({
        delivery: webhookDeliveries,
        eventType: outboxEvents.eventType,
        cursorTs: sql<string>`to_char(${webhookDeliveries.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(webhookDeliveries)
      .innerJoin(outboxEvents, eq(outboxEvents.id, webhookDeliveries.eventId))
      .where(
        and(
          eq(webhookDeliveries.tenantId, tenantId as TenantId),
          eq(webhookDeliveries.endpointId, endpointId),
          environmentId
            ? eq(
                webhookDeliveries.environmentId,
                environmentId as EnvironmentId,
              )
            : undefined,
          state ? eq(webhookDeliveries.state, state) : undefined,
          page.before
            ? or(
                // ::text::timestamptz — a bare ::timestamptz on the driver-bound ISO string
                // truncates to ms, skipping sub-ms rows; the text hop preserves µs. See cursor.ts.
                sql`${webhookDeliveries.createdAt} < ${page.before.createdAt}::text::timestamptz`,
                and(
                  sql`${webhookDeliveries.createdAt} = ${page.before.createdAt}::text::timestamptz`,
                  lt(webhookDeliveries.id, page.before.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
      .limit(page.limit + 1);
    const hasMore = rows.length > page.limit;
    const visible = hasMore ? rows.slice(0, page.limit) : rows;
    const last = visible[visible.length - 1];
    return {
      deliveries: visible.map((row) =>
        toDeliveryDto(row.delivery, row.eventType),
      ),
      next_cursor:
        hasMore && last
          ? encodeCursor({
              createdAt: last.cursorTs,
              id: last.delivery.id,
            })
          : null,
    };
  });
}
