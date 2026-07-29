// ============================================================================================
// SDK-005 AC06 — attempt-time rechecks on the queued worker path. A kill-switch flip or a STOP
// that lands AFTER acceptance but BEFORE provider contact must block the dispatch: the worker
// fails the prepared send with the block reason, the reservation refunds exactly once, the
// delivery + attempt converge on `failed` with the reason recorded, the terminal transition
// rides the transactional outbox, and a replayed job is a no-op. tier: test:integration.
// ============================================================================================

import { randomUUID } from "node:crypto";
import { createAppDb } from "@app/db";
import { DEFAULT_EMAIL_BASE_RATES, DEFAULT_RATES } from "@app/domain";
import { prepareSend } from "@app/sms-engine";
import type { ConfigService } from "@nestjs/config";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ConsentService } from "../consent/consent.service.js";
import type { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import type { PricingService } from "../pricing/pricing.service.js";
import { PiiVaultService } from "../privacy/pii-vault.service.js";
import { QueueService } from "../queue/queue.service.js";
import type { SendersService } from "../senders/senders.service.js";
import { SmsService } from "../sms/sms.service.js";
import type { VirtualPhoneService } from "../sms/virtual-phone.service.js";
import {
  cleanManagedTenant,
  seedManagedTenant,
} from "./managed-messages.spec-harness.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;

describeDb(
  "SDK-005 attempt-time rechecks (accept → world changes → worker)",
  () => {
    const owner = postgres(superUrl ?? "", { max: 2 });
    const db = createAppDb(appUrl ?? "");
    const tenantId = randomUUID();
    const rawKey = `sk_test_${randomUUID().replace(/-/g, "")}${"0".repeat(8)}`;
    const CREDIT = 10_000n;
    let applicationId = "";
    let environmentId = "";
    let definitionId = "";
    let versionId = "";
    let vault: PiiVaultService;
    let sms: SmsService;
    // Mutable world state the worker rechecks — flipped between acceptance and dispatch.
    let smsPaused = false;
    let optedOut = false;

    async function customerBalance(): Promise<bigint> {
      const rows = await owner`
      SELECT balance_minor FROM ledger_accounts
      WHERE tenant_id = ${tenantId} AND kind = 'customer' AND currency = 'GHS'`;
      return BigInt(String(rows[0]?.balance_minor ?? "0"));
    }

    /** tx1 exactly as the API accepts a managed send — durable dispatch material included. */
    async function acceptManaged(
      deliveryId: string,
      key: string,
    ): Promise<void> {
      const to = "+233200000042";
      const subjectId = await vault.subjectForPhone(tenantId, to);
      const bodyPiiId = await vault.put(
        tenantId,
        subjectId,
        "body",
        "Hi Ada, 2 orders.",
      );
      // Same slug the runtime's virtual deps use — dispatch resolves the DLR by provider_slug.
      await prepareSend(
        { db, provider: { slug: "virtual-phone" } as never },
        {
          tenantId,
          messageId: deliveryId,
          applicationId,
          environmentId,
          to,
          senderId: "FABRIC",
          body: "Hi Ada, 2 orders.",
          currency: "GHS",
          deliveryMode: "live",
          subjectId,
          bodyPiiId,
          managed: {
            deliveryId,
            definitionId,
            versionId,
            key: "order.shipped",
            locale: "en",
            metadata: {},
            idempotencyKey: key,
            requestFingerprint: "c".repeat(64),
            expiresAt: new Date(Date.now() + 30 * 86_400_000),
          },
        },
      );
    }

    async function assertBlocked(
      deliveryId: string,
      reason: string,
    ): Promise<void> {
      const result = await sms.processQueuedSend({
        tenantId,
        messageId: deliveryId,
        deliveryMode: "live",
      });
      expect(result.status).toBe("failed");

      const [message] = await owner`
      SELECT status, error_code FROM messages WHERE id = ${deliveryId}`;
      expect(message).toMatchObject({ status: "failed", error_code: reason });
      const [delivery] = await owner`
      SELECT status FROM message_deliveries WHERE id = ${deliveryId}`;
      expect(delivery?.status).toBe("failed");
      const [attempt] = await owner`
      SELECT status, error_code FROM message_delivery_attempts
      WHERE delivery_id = ${deliveryId}`;
      expect(attempt).toMatchObject({ status: "failed", error_code: reason });
      const terminal = await owner`
      SELECT 1 FROM outbox_events
      WHERE tenant_id = ${tenantId} AND event_type = 'message.updated'
        AND payload->>'message_id' = ${deliveryId}
        AND payload->>'status' = 'failed'`;
      expect(terminal.length).toBe(1);

      // Refund landed exactly once, and replaying the job (worker retry) changes nothing.
      expect(await customerBalance()).toBe(CREDIT);
      const replay = await sms.processQueuedSend({
        tenantId,
        messageId: deliveryId,
        deliveryMode: "live",
      });
      expect(replay.status).toBe("failed");
      expect(await customerBalance()).toBe(CREDIT);
      const refunds = await owner`
      SELECT count(*)::int AS n FROM ledger_entries
      WHERE tenant_id = ${tenantId} AND reason = 'message_refund' AND reference_id = ${deliveryId}`;
      expect(Number(refunds[0]?.n)).toBe(2);
    }

    beforeAll(async () => {
      const seeded = await seedManagedTenant({ owner, db, tenantId, rawKey });
      applicationId = seeded.applicationId;
      environmentId = seeded.environmentId;
      const [definition] = await owner`
      SELECT d.id AS definition_id, v.id AS version_id
      FROM message_definitions d
      JOIN message_definition_versions v ON v.definition_id = d.id
      WHERE d.tenant_id = ${tenantId} LIMIT 1`;
      if (!definition) throw new Error("definition not seeded");
      definitionId = String(definition.definition_id);
      versionId = String(definition.version_id);

      const config = { get: () => undefined } as unknown as ConfigService;
      vault = new PiiVaultService(db, config);
      sms = new SmsService(
        db,
        {
          isPaused: async (key: string) =>
            smsPaused && key === "platform.sms_sending",
        } as unknown as KillSwitchService,
        config,
        new QueueService(config),
        {
          senderStatus: async () => "active" as const,
        } as unknown as SendersService,
        { isSuppressed: async () => optedOut } as unknown as ConsentService,
        {
          resolveMode: async () => "virtual",
        } as unknown as VirtualPhoneService,
        vault,
        {
          resolveRates: async () => ({
            sms: DEFAULT_RATES,
            email: DEFAULT_EMAIL_BASE_RATES,
          }),
        } as unknown as PricingService,
      );
    });

    afterAll(async () => {
      await owner`DELETE FROM virtual_deliveries WHERE tenant_id = ${tenantId}`;
      await cleanManagedTenant(owner, tenantId);
      await Promise.all([owner.end(), db.end()]);
    });

    it("blocks a queued dispatch when the kill-switch flipped after acceptance", async () => {
      const deliveryId = randomUUID();
      await acceptManaged(deliveryId, "recheck-killswitch");
      expect(await customerBalance()).toBe(CREDIT - 3n);

      smsPaused = true;
      try {
        await assertBlocked(deliveryId, "sms_sending_paused");
      } finally {
        smsPaused = false;
      }
    });

    it("blocks a queued dispatch when the recipient opted out after acceptance", async () => {
      const deliveryId = randomUUID();
      await acceptManaged(deliveryId, "recheck-optout");
      optedOut = true;
      try {
        await assertBlocked(deliveryId, "recipient_opted_out");
      } finally {
        optedOut = false;
      }
    });

    it("dispatches normally when the world is unchanged", async () => {
      const deliveryId = randomUUID();
      await acceptManaged(deliveryId, "recheck-clean");
      const result = await sms.processQueuedSend({
        tenantId,
        messageId: deliveryId,
        deliveryMode: "live",
      });
      expect(["delivered", "sent", "accepted"]).toContain(result.status);
      // Virtual traffic reserves through the real wallet path and refunds at the terminal —
      // sandbox rehearses the money flow without charging for it.
      expect(await customerBalance()).toBe(CREDIT);
    });
  },
);
