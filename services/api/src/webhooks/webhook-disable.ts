import {
  type AppDb,
  type EnvironmentId,
  type TenantId,
  webhookEndpoints,
} from "@app/db";
import { and, eq, sql } from "drizzle-orm";
import { notFound } from "../http/api-error.js";

export async function disableWebhookEndpoint(
  db: AppDb,
  tenantId: string,
  id: string,
  environmentId?: string,
): Promise<void> {
  const disabled = await db.withTenantDrizzle(tenantId, async (tx) => {
    const rows = await tx
      .update(webhookEndpoints)
      .set({ status: "disabled", updatedAt: new Date() })
      .where(
        and(
          eq(webhookEndpoints.tenantId, tenantId as TenantId),
          eq(webhookEndpoints.id, id),
          environmentId
            ? eq(webhookEndpoints.environmentId, environmentId as EnvironmentId)
            : undefined,
        ),
      )
      .returning({ id: webhookEndpoints.id });
    if (rows.length === 0) return rows;
    await tx.execute(sql`
      UPDATE webhook_deliveries
      SET state = 'dead', lease_token = NULL, lease_expires_at = NULL,
          last_error_category = 'endpoint_disabled', updated_at = now()
      WHERE endpoint_id = ${id}::uuid AND state IN ('pending', 'delivering')
    `);
    await tx.execute(sql`
      UPDATE outbox_events o SET delivered_at = now(), updated_at = now()
      WHERE o.delivered_at IS NULL
        AND EXISTS (SELECT 1 FROM webhook_deliveries d WHERE d.event_id = o.id)
        AND NOT EXISTS (
          SELECT 1 FROM webhook_deliveries d
          WHERE d.event_id = o.id AND d.state IN ('pending', 'delivering')
        )
    `);
    return rows;
  });
  if (disabled.length === 0) {
    throw notFound("webhook_not_found", "No webhook endpoint with that id.");
  }
}
