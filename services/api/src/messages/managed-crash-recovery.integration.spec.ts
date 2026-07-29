// ============================================================================================
// SDK-005 AC04 — crash recovery for the managed path. Simulates a crash AFTER acceptance
// (tx1 committed: message `sending` + reservation + delivery `accepted` + attempt + acceptance
// outbox event) and BEFORE any provider contact, then proves the standing sweeper resolves the
// original attempt safely: message/delivery/attempt all reach `expired`, the reservation refunds
// EXACTLY once (second pass is a no-op), no provider was ever contacted, and the terminal
// transition rides the transactional outbox. tier: test:integration.
// ============================================================================================

import { randomUUID } from "node:crypto";
import { createAppDb } from "@app/db";
import { DEFAULT_EMAIL_BASE_RATES, DEFAULT_RATES } from "@app/domain";
import { FakeProvider } from "@app/integrations/testing";
import { prepareSend } from "@app/sms-engine";
import type { ConfigService } from "@nestjs/config";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

describeDb("SDK-005 managed crash recovery (accept → crash → sweep)", () => {
  const owner = postgres(superUrl ?? "", { max: 2 });
  const db = createAppDb(appUrl ?? "");
  const tenantId = randomUUID();
  const rawKey = `sk_test_${randomUUID().replace(/-/g, "")}${"0".repeat(8)}`;
  const deliveryId = randomUUID();
  const CREDIT = 10_000n;
  const COST = 3n; // "Hi Ada, 2 orders." = 1 gsm7 segment at the GHS rate.
  let applicationId = "";
  let environmentId = "";
  let sms: SmsService;

  async function customerBalance(): Promise<bigint> {
    const rows = await owner`
      SELECT balance_minor FROM ledger_accounts
      WHERE tenant_id = ${tenantId} AND kind = 'customer' AND currency = 'GHS'`;
    return BigInt(String(rows[0]?.balance_minor ?? "0"));
  }

  beforeAll(async () => {
    const seeded = await seedManagedTenant({ owner, db, tenantId, rawKey });
    applicationId = seeded.applicationId;
    environmentId = seeded.environmentId;
    const config = { get: () => undefined } as unknown as ConfigService;
    sms = new SmsService(
      db,
      { isPaused: async () => false } as unknown as KillSwitchService,
      config,
      new QueueService(config),
      {
        senderStatus: async () => "active" as const,
      } as unknown as SendersService,
      { isSuppressed: async () => false } as unknown as ConsentService,
      { resolveMode: async () => "virtual" } as unknown as VirtualPhoneService,
      new PiiVaultService(db, config),
      {
        resolveRates: async () => ({
          sms: DEFAULT_RATES,
          email: DEFAULT_EMAIL_BASE_RATES,
        }),
      } as unknown as PricingService,
    );
  });

  afterAll(async () => {
    await cleanManagedTenant(owner, tenantId);
    await Promise.all([owner.end(), db.end()]);
  });

  it("recovers a delivery stranded after acceptance without double refund or provider contact", async () => {
    const [definition] = await owner`
      SELECT d.id AS definition_id, v.id AS version_id
      FROM message_definitions d
      JOIN message_definition_versions v ON v.definition_id = d.id
      WHERE d.tenant_id = ${tenantId} LIMIT 1`;
    if (!definition) throw new Error("definition not seeded");

    // tx1 exactly as the API runs it — then nothing. The missing dispatch IS the crash.
    const provider = new FakeProvider();
    const providerSend = vi.spyOn(provider, "send");
    const prepared = await prepareSend(
      { db, provider },
      {
        tenantId,
        messageId: deliveryId,
        applicationId,
        environmentId,
        to: "+233200000042",
        senderId: "FABRIC",
        body: "Hi Ada, 2 orders.",
        currency: "GHS",
        deliveryMode: "live",
        managed: {
          deliveryId,
          definitionId: String(definition.definition_id),
          versionId: String(definition.version_id),
          key: "order.shipped",
          locale: "en",
          metadata: {},
          idempotencyKey: "crash-001",
          requestFingerprint: "b".repeat(64),
          expiresAt: new Date(Date.now() + 30 * 86_400_000),
        },
      },
    );
    expect(prepared.messageId).toBe(deliveryId);

    // Accepted state is durable and funded: reservation held, delivery + attempt recoverable.
    expect(await customerBalance()).toBe(CREDIT - COST);
    const [before] = await owner`
      SELECT status, resource_version FROM message_deliveries WHERE id = ${deliveryId}`;
    expect(before).toMatchObject({ status: "accepted", resource_version: 1 });

    // Crash recovery: the message sat non-terminal past the TTL; the standing sweeper fires.
    await owner`
      UPDATE messages SET updated_at = now() - interval '1 hour' WHERE id = ${deliveryId}`;
    const swept = await sms.sweepStuck(tenantId, new Date().toISOString());
    expect(swept).toBe(1);

    // The original attempt fails safely — message, attempt, and delivery agree on `expired`,
    // the aggregate version moved, and the terminal transition rode the transactional outbox.
    const [message] = await owner`
      SELECT status FROM messages WHERE id = ${deliveryId}`;
    expect(message?.status).toBe("expired");
    const [delivery] = await owner`
      SELECT status, resource_version FROM message_deliveries WHERE id = ${deliveryId}`;
    expect(delivery?.status).toBe("expired");
    expect(Number(delivery?.resource_version)).toBeGreaterThan(1);
    const [attempt] = await owner`
      SELECT status FROM message_delivery_attempts WHERE delivery_id = ${deliveryId}`;
    expect(attempt?.status).toBe("expired");
    const outbox = await owner`
      SELECT event_type, payload->>'status' AS status FROM outbox_events
      WHERE tenant_id = ${tenantId} ORDER BY created_at`;
    expect(outbox).toContainEqual(
      expect.objectContaining({ event_type: "message.accepted" }),
    );
    expect(outbox).toContainEqual(
      expect.objectContaining({
        event_type: "message.updated",
        status: "expired",
      }),
    );

    // Money moved exactly once: full refund, and a second sweep changes nothing.
    expect(await customerBalance()).toBe(CREDIT);
    const secondPass = await sms.sweepStuck(tenantId, new Date().toISOString());
    expect(secondPass).toBe(0);
    expect(await customerBalance()).toBe(CREDIT);
    const refunds = await owner`
      SELECT count(*)::int AS n FROM ledger_entries
      WHERE tenant_id = ${tenantId} AND reason = 'message_refund' AND reference_id = ${deliveryId}`;
    expect(Number(refunds[0]?.n)).toBe(2);

    // No provider contact ever happened — the crash preceded dispatch, and the sweep resolves
    // without re-driving the provider.
    expect(providerSend).not.toHaveBeenCalled();
  });
});
