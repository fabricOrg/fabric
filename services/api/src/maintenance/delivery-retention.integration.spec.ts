// ============================================================================================
// SDK-005 retention — managed-delivery purge against a real migrated DB. Proves: an expired,
// unheld delivery (and its attempts) is deleted; legal_hold pins an expired row indefinitely; an
// unexpired row is untouched; a second pass is a no-op. tier: test:integration.
// ============================================================================================

import { randomUUID } from "node:crypto";
import { createAppDb, createProvisioningDb } from "@app/db";
import { Logger } from "@nestjs/common";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cleanManagedTenant,
  seedManagedTenant,
} from "../messages/managed-messages.spec-harness.js";
import { runDeliveryRetention } from "./maintenance-retention.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;

describeDb("managed-delivery retention purge", () => {
  const owner = postgres(superUrl ?? "", { max: 2 });
  const provisioning = createProvisioningDb(superUrl ?? "", { max: 1 });
  const db = createAppDb(appUrl ?? "");
  const logger = new Logger("delivery-retention-spec");
  const tenantId = randomUUID();
  const rawKey = `sk_test_${randomUUID().replace(/-/g, "")}${"0".repeat(8)}`;
  const expiredId = randomUUID();
  const heldId = randomUUID();
  const freshId = randomUUID();
  let applicationId = "";
  let environmentId = "";

  async function insertDelivery(
    id: string,
    expiresAt: string,
    legalHold: boolean,
  ): Promise<void> {
    const [definition] = await owner`
      SELECT d.id AS definition_id, v.id AS version_id
      FROM message_definitions d
      JOIN message_definition_versions v ON v.definition_id = d.id
      WHERE d.tenant_id = ${tenantId} LIMIT 1`;
    if (!definition) throw new Error("definition not seeded");
    await owner`
      INSERT INTO message_deliveries (
        id, tenant_id, application_id, environment_id, definition_id, version_id,
        key, locale, channel, status, idempotency_key, request_fingerprint,
        currency, legal_hold, expires_at
      ) VALUES (
        ${id}, ${tenantId}, ${applicationId}, ${environmentId},
        ${definition.definition_id}, ${definition.version_id},
        'order.shipped', 'en', 'sms', 'delivered', ${`retention-${id}`},
        ${"a".repeat(64)}, 'GHS', ${legalHold}, ${expiresAt}::timestamptz
      )`;
    await owner`
      INSERT INTO message_delivery_attempts (
        tenant_id, application_id, environment_id, delivery_id, ordinal,
        channel, status, currency
      ) VALUES (
        ${tenantId}, ${applicationId}, ${environmentId}, ${id}, 1,
        'sms', 'delivered', 'GHS'
      )`;
  }

  beforeAll(async () => {
    const seeded = await seedManagedTenant({ owner, db, tenantId, rawKey });
    applicationId = seeded.applicationId;
    environmentId = seeded.environmentId;
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    await insertDelivery(expiredId, past, false);
    await insertDelivery(heldId, past, true);
    await insertDelivery(freshId, future, false);
  });

  afterAll(async () => {
    await cleanManagedTenant(owner, tenantId);
    await Promise.all([owner.end(), provisioning.end(), db.end()]);
  });

  it("purges expired unheld deliveries, keeps legal holds and unexpired rows", async () => {
    const result = await runDeliveryRetention(provisioning, logger);
    expect(result.locked).toBe(true);
    // Other tenants' expired rows may purge in the same pass — assert at-least for globals,
    // exactly for this tenant's rows below.
    expect(result.deliveries).toBeGreaterThanOrEqual(1);
    expect(result.attempts).toBeGreaterThanOrEqual(1);

    const remaining = await owner`
      SELECT id, legal_hold FROM message_deliveries
      WHERE tenant_id = ${tenantId} ORDER BY id`;
    expect(remaining.map((row) => String(row.id)).sort()).toEqual(
      [heldId, freshId].sort(),
    );
    const attempts = await owner`
      SELECT delivery_id FROM message_delivery_attempts
      WHERE tenant_id = ${tenantId}`;
    expect(attempts.map((row) => String(row.delivery_id)).sort()).toEqual(
      [heldId, freshId].sort(),
    );
  });

  it("is a no-op on the next pass (nothing newly expired)", async () => {
    const result = await runDeliveryRetention(provisioning, logger);
    expect(result.locked).toBe(true);
    const remaining = await owner`
      SELECT count(*)::int AS n FROM message_deliveries WHERE tenant_id = ${tenantId}`;
    expect(Number(remaining[0]?.n)).toBe(2);
  });
});
