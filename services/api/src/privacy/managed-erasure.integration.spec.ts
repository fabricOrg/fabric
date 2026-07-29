// ============================================================================================
// SDK-005 — tenant export/deletion handling for managed deliveries. Proves the DSR seam: the
// subject summary counts the subject's managed deliveries (their caller-supplied
// reference/metadata is personal data the vault never held); crypto-shred erasure scrubs that
// reference/metadata in the SAME transaction as the key destruction while status, cost, and the
// attempt survive (financial history is never edited); and the audit record carries the scrub
// count. Tenant deletion = accounts soft-close (terminal) + the standing retention purge, which
// runs status-blind across tenants — asserted here by purging a closed tenant's expired rows.
// tier: test:integration.
// ============================================================================================

import { randomUUID } from "node:crypto";
import { createAppDb, createProvisioningDb } from "@app/db";
import { prepareSend } from "@app/sms-engine";
import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditService } from "../audit/audit.service.js";
import { runDeliveryRetention } from "../maintenance/maintenance-retention.js";
import {
  cleanManagedTenant,
  seedManagedTenant,
} from "../messages/managed-messages.spec-harness.js";
import { PiiErasureService } from "./pii-erasure.service.js";
import { PiiVaultService } from "./pii-vault.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;

describeDb(
  "SDK-005 managed deliveries under DSR erasure + tenant offboarding",
  () => {
    const owner = postgres(superUrl ?? "", { max: 2 });
    const provisioning = createProvisioningDb(superUrl ?? "", { max: 1 });
    const db = createAppDb(appUrl ?? "");
    const tenantId = randomUUID();
    const rawKey = `sk_test_${randomUUID().replace(/-/g, "")}${"0".repeat(8)}`;
    const deliveryId = randomUUID();
    const recipient = "+233200000042";
    const auditRecords: Array<Record<string, unknown>> = [];
    const audit = {
      record: async (input: Record<string, unknown>) => {
        auditRecords.push(input);
      },
    } as unknown as AuditService;
    let vault: PiiVaultService;
    let erasure: PiiErasureService;

    beforeAll(async () => {
      const seeded = await seedManagedTenant({ owner, db, tenantId, rawKey });
      const config = {
        get: (key: string) => process.env[key],
      } as unknown as ConfigService;
      vault = new PiiVaultService(db, config);
      erasure = new PiiErasureService(db, config, audit);

      // One managed delivery for the subject, accepted through the engine's real tx1.
      const [definition] = await owner`
      SELECT d.id AS definition_id, v.id AS version_id
      FROM message_definitions d
      JOIN message_definition_versions v ON v.definition_id = d.id
      WHERE d.tenant_id = ${tenantId} LIMIT 1`;
      if (!definition) throw new Error("definition not seeded");
      const subjectId = await vault.subjectForPhone(tenantId, recipient);
      const bodyPiiId = await vault.put(
        tenantId,
        subjectId,
        "body",
        "Hi Ada, 2 orders.",
      );
      await prepareSend(
        { db, provider: { slug: "virtual-phone" } as never },
        {
          tenantId,
          messageId: deliveryId,
          applicationId: seeded.applicationId,
          environmentId: seeded.environmentId,
          to: recipient,
          senderId: "FABRIC",
          body: "Hi Ada, 2 orders.",
          currency: "GHS",
          deliveryMode: "live",
          subjectId,
          bodyPiiId,
          managed: {
            deliveryId,
            definitionId: String(definition.definition_id),
            versionId: String(definition.version_id),
            key: "order.shipped",
            locale: "en",
            reference: "order-4711-for-ada",
            metadata: { customer_name: "Ada" },
            idempotencyKey: "erasure-001",
            requestFingerprint: "d".repeat(64),
            expiresAt: new Date(Date.now() + 30 * 86_400_000),
          },
        },
      );
    });

    afterAll(async () => {
      await owner`DELETE FROM erasure_log WHERE tenant_id = ${tenantId}`;
      await cleanManagedTenant(owner, tenantId);
      await Promise.all([owner.end(), provisioning.end(), db.end()]);
    });

    it("counts managed deliveries in the DSR summary, scrubs them on erasure, keeps the money facts", async () => {
      const summary = await erasure.subjectSummary(tenantId, recipient);
      expect(summary).toMatchObject({ managed_deliveries: 1, erased: false });

      const result = await erasure.eraseByPhone({
        tenantId,
        e164: recipient,
        requestedBy: "staff@fabric.test",
        basis: "DSR erasure request",
      });
      expect(result.erased).toBe(true);

      // Caller-supplied personal data is gone; the delivery's financial identity is not.
      const [delivery] = await owner`
      SELECT reference, metadata, status, total_cost_minor FROM message_deliveries
      WHERE id = ${deliveryId}`;
      expect(delivery).toMatchObject({ reference: null, metadata: {} });
      expect(delivery?.status).toBeDefined();
      const [attempt] = await owner`
      SELECT count(*)::int AS n FROM message_delivery_attempts WHERE delivery_id = ${deliveryId}`;
      expect(Number(attempt?.n)).toBe(1);
      expect(auditRecords).toContainEqual(
        expect.objectContaining({
          action: "privacy.subject.erased",
          metadata: expect.objectContaining({ managed_deliveries_scrubbed: 1 }),
        }),
      );
    });

    it("purges a soft-closed tenant's expired deliveries via the standing retention job", async () => {
      // Offboarding = soft-close (accounts are never hard-deleted). Retention runs status-blind.
      await owner`UPDATE accounts SET status = 'closed' WHERE id = ${tenantId}`;
      await owner`
      UPDATE message_deliveries SET expires_at = now() - interval '1 day'
      WHERE id = ${deliveryId}`;
      const result = await runDeliveryRetention(
        provisioning,
        new Logger("managed-erasure-spec"),
      );
      expect(result.locked).toBe(true);
      const rows = await owner`
      SELECT count(*)::int AS n FROM message_deliveries WHERE tenant_id = ${tenantId}`;
      expect(Number(rows[0]?.n)).toBe(0);
      // Ledger rows survive offboarding — money history outlives message content by design.
      const ledger = await owner`
      SELECT count(*)::int AS n FROM ledger_entries WHERE tenant_id = ${tenantId}`;
      expect(Number(ledger[0]?.n)).toBeGreaterThan(0);
    });
  },
);
