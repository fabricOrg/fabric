import type { WebhookDeliveryDto } from "@app/contracts";
import {
  type AppDb,
  outboxEvents,
  type TenantId,
  webhookDeliveries,
} from "@app/db";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { encodeCursor, type PageInput } from "../http/cursor.js";
import { toDeliveryDto } from "./webhook-dto.js";

/** Cursor-paginated per-endpoint delivery history (split from webhooks.service for file length). */
export async function listEndpointDeliveries(
  db: AppDb,
  tenantId: string,
  endpointId: string,
  state: "pending" | "delivering" | "delivered" | "dead" | undefined,
  page: PageInput,
): Promise<{ deliveries: WebhookDeliveryDto[]; next_cursor: string | null }> {
  return db.withTenantDrizzle(tenantId, async (tx) => {
    const rows = await tx
      .select({
        delivery: webhookDeliveries,
        eventType: outboxEvents.eventType,
      })
      .from(webhookDeliveries)
      .innerJoin(outboxEvents, eq(outboxEvents.id, webhookDeliveries.eventId))
      .where(
        and(
          eq(webhookDeliveries.tenantId, tenantId as TenantId),
          eq(webhookDeliveries.endpointId, endpointId),
          state ? eq(webhookDeliveries.state, state) : undefined,
          page.before
            ? or(
                lt(webhookDeliveries.createdAt, page.before.createdAt),
                and(
                  eq(webhookDeliveries.createdAt, page.before.createdAt),
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
              createdAt: last.delivery.createdAt,
              id: last.delivery.id,
            })
          : null,
    };
  });
}
