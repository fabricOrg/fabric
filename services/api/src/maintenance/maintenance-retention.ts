import type { ProvisioningDb } from "@app/db";
import type { Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";

/** Advisory lock keys (stable app-wide constants; one per job — see MaintenanceService). */
export const LOG_RETENTION_LOCK_KEY = 727_003;
export const DELIVERY_RETENTION_LOCK_KEY = 727_005;

/**
 * One request-log retention pass. Deletes rows past the retention window across all tenants on the
 * provisioner connection (request_logs grants app_provisioner DELETE; cross-tenant by design — no
 * per-tenant loop for a pure purge). Advisory-locked so overlapping ticks are a no-op.
 */
export async function runLogRetention(
  provisioning: ProvisioningDb,
  logger: Logger,
  retentionDays: number,
): Promise<{ locked: boolean; deleted: number }> {
  return provisioning.db.transaction(async (tx) => {
    const lockRows = (await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(${LOG_RETENTION_LOCK_KEY}) AS locked`,
    )) as Array<{ locked: boolean }>;
    if (lockRows[0]?.locked !== true) return { locked: false, deleted: 0 };

    const cutoffIso = new Date(
      Date.now() - retentionDays * 86_400_000,
    ).toISOString();
    const deletedRows = (await tx.execute(
      sql`DELETE FROM request_logs WHERE created_at < ${cutoffIso}::timestamptz RETURNING id`,
    )) as Array<{ id: string }>;
    if (deletedRows.length > 0) {
      logger.log(
        `log retention: deleted ${deletedRows.length} request log(s) older than ${retentionDays}d`,
      );
    }
    return { locked: true, deleted: deletedRows.length };
  });
}

/**
 * One managed-delivery retention pass (COMPLIANCE §5: rendered content + delivery metadata are not
 * an archive). Deletes deliveries whose `expires_at` (stamped at acceptance from the retention
 * schedule) has passed — UNLESS `legal_hold` is set, which pins the row indefinitely. Attempts go
 * first (their containment FK is RESTRICT). Ledger and audit rows are untouched: money and audit
 * integrity outlive message content by design. Cross-tenant DELETE on the provisioner (0082 grants);
 * discovery is served by the partial idx_message_deliveries_retention (expires_at WHERE NOT
 * legal_hold), so the pass stays cheap when healthy.
 */
export async function runDeliveryRetention(
  provisioning: ProvisioningDb,
  logger: Logger,
): Promise<{ locked: boolean; deliveries: number; attempts: number }> {
  return provisioning.db.transaction(async (tx) => {
    const lockRows = (await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(${DELIVERY_RETENTION_LOCK_KEY}) AS locked`,
    )) as Array<{ locked: boolean }>;
    if (lockRows[0]?.locked !== true) {
      return { locked: false, deliveries: 0, attempts: 0 };
    }

    const attemptRows = (await tx.execute(
      sql`DELETE FROM message_delivery_attempts a
          USING message_deliveries d
          WHERE a.delivery_id = d.id
            AND d.expires_at < now()
            AND d.legal_hold = false
          RETURNING a.id`,
    )) as Array<{ id: string }>;
    const deliveryRows = (await tx.execute(
      sql`DELETE FROM message_deliveries
          WHERE expires_at < now() AND legal_hold = false
          RETURNING id`,
    )) as Array<{ id: string }>;
    if (deliveryRows.length > 0) {
      logger.log(
        `delivery retention: purged ${deliveryRows.length} delivery(ies) + ${attemptRows.length} attempt(s) past expiry`,
      );
    }
    return {
      locked: true,
      deliveries: deliveryRows.length,
      attempts: attemptRows.length,
    };
  });
}
