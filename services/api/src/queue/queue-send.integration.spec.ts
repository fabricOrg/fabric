import { randomUUID } from "node:crypto";
import {
  accounts,
  createAppDb,
  createProvisioningDb,
  type TenantId,
} from "@app/db";
import { credit } from "@app/wallet";
import type { ConfigService } from "@nestjs/config";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ConsentService } from "../consent/consent.service.js";
import type { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import { PricingService } from "../pricing/pricing.service.js";
import { PiiVaultService } from "../privacy/pii-vault.service.js";
import type { SendersService } from "../senders/senders.service.js";
import { SmsService } from "../sms/sms.service.js";
import { SMS_SEND_QUEUE } from "../sms/sms-send.job.js";
import { SmsSendWorker } from "../sms/sms-send.worker.js";
import type { VirtualPhoneService } from "../sms/virtual-phone.service.js";
import { QueueService } from "./queue.service.js";

// E10-S4: sender enforcement has its own spec — these flows always pass the gate.
// E10-S5: consent enforcement has its own spec — nobody is opted out here.
const consentAllowAll = {
  isSuppressed: async () => false,
} as unknown as ConsentService;
const sendersAlwaysActive = {
  senderStatus: async () => "active" as const,
} as unknown as SendersService;

/**
 * QUEUED SEND PIPELINE — integration spec (finding 7 PR A). Real Postgres + REAL Redis (the
 * docker-compose redis-queue CI also boots). Proves:
 *   1. e2e queued send: POST returns `sending` fast; the in-process worker runs the provider call
 *      + tx2; the message reaches `accepted` with the commit posted EXACTLY once.
 *   2. worker retry idempotency: processQueuedSend run twice (a BullMQ retry after a crash between
 *      provider-ack and tx2) never double-commits.
 *   3. queue disabled → inline fallback (the pre-queue behavior, provider outcome in-response).
 */

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP ?? superUrl;
const redisUrl = process.env.REDIS_QUEUE_URL ?? "redis://localhost:6379";
const describeDb = superUrl ? describe : describe.skip;

function configStub(values: Record<string, string>): ConfigService {
  return { get: (k: string) => values[k] } as unknown as ConfigService;
}

const killSwitch = {
  isPaused: async () => false,
} as unknown as KillSwitchService;
const liveMode = {
  resolveMode: async () => "live",
} as unknown as VirtualPhoneService;

describeDb("queued send pipeline (BullMQ)", () => {
  const provisioning = createProvisioningDb(superUrl ?? "", { max: 2 });
  const appDb = createAppDb(appUrl ?? "");
  // Real vault against the test Postgres: the send path tokenizes every recipient.
  const vault = new PiiVaultService(appDb, configStub({}));
  const owner = postgres(superUrl ?? "", { max: 1 });

  // Unique prefix per run: a locally running dev stack shares this Redis and its own sms-send
  // worker would otherwise race this spec's worker for the same jobs.
  const queueOn = new QueueService(
    configStub({
      REDIS_QUEUE_URL: redisUrl,
      REDIS_QUEUE_PREFIX: `test-${randomUUID().slice(0, 8)}`,
    }),
  );
  const queueOff = new QueueService(configStub({}));
  const smsQueued = new SmsService(
    appDb,
    killSwitch,
    configStub({}),
    queueOn,
    sendersAlwaysActive,
    consentAllowAll,
    liveMode,
    vault,
    new PricingService(provisioning),
  );
  const smsInline = new SmsService(
    appDb,
    killSwitch,
    configStub({}),
    queueOff,
    sendersAlwaysActive,
    consentAllowAll,
    liveMode,
    vault,
    new PricingService(provisioning),
  );

  const tenantId = randomUUID() as TenantId;
  const CREDIT = 100_000n;

  beforeAll(async () => {
    // A clean queue so a previous run's jobs can't bleed into this one.
    await queueOn.queue(SMS_SEND_QUEUE).obliterate({ force: true });
    new SmsSendWorker(queueOn, smsQueued, configStub({})).onModuleInit();

    await provisioning.db.insert(accounts).values({
      id: tenantId,
      name: "Queue Test",
      slug: `queue-${tenantId}`,
    });
    await appDb.withTenant(tenantId, (tx) =>
      credit(tx, {
        currency: "GHS",
        amountMinor: CREDIT,
        idempotencyKey: `topup:queue-${tenantId}`,
      }),
    );
  });

  afterAll(async () => {
    await queueOn.onModuleDestroy();
    await queueOff.onModuleDestroy();
    await owner`DELETE FROM messages WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM ledger_entries WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM ledger_transactions WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM ledger_accounts WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM accounts WHERE id = ${tenantId}`;
    await Promise.all([provisioning.end(), appDb.end(), owner.end()]);
  });

  async function messageStatus(id: string): Promise<string> {
    const rows = await owner`SELECT status FROM messages WHERE id = ${id}`;
    return String(rows[0]?.status);
  }

  async function commitCount(messageId: string): Promise<number> {
    const rows = await owner`
      SELECT count(DISTINCT txn_id)::int AS n FROM ledger_entries
      WHERE tenant_id = ${tenantId} AND reason = 'message_commit' AND reference_id = ${messageId}`;
    return Number(rows[0]?.n);
  }

  async function waitFor(
    predicate: () => Promise<boolean>,
    timeoutMs = 15_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error("waitFor: condition not met in time");
  }

  const sendInput = (to: string) => ({
    tenantId: tenantId as string,
    to,
    senderId: "FABRIC",
    body: "queued pipeline test",
    currency: "GHS",
  });

  it("e2e: queued send returns `sending`, worker resolves to accepted with ONE commit", async () => {
    const response = await smsQueued.send(sendInput("+233209999001"));
    expect(response.status).toBe("sending"); // reserved + enqueued, provider outcome pending

    const job = await queueOn.queue(SMS_SEND_QUEUE).getJob(response.id);
    expect(job?.data).toEqual({
      tenantId,
      messageId: response.id,
      deliveryMode: "live",
    });
    expect(JSON.stringify(job?.data)).not.toContain("+233209999001");
    expect(JSON.stringify(job?.data)).not.toContain("queued pipeline test");

    await waitFor(
      async () => (await messageStatus(response.id)) === "accepted",
    );
    expect(await commitCount(response.id)).toBe(1);
    const dispatch = await owner`
      SELECT completed_at FROM message_dispatches WHERE message_id = ${response.id}`;
    expect(dispatch[0]?.completed_at).not.toBeNull();
  });

  it("recovers a committed dispatch intent when the original queue job is lost", async () => {
    const queue = queueOn.queue(SMS_SEND_QUEUE);
    await queue.pause();
    const response = await smsQueued.send(sendInput("+233209999004"));
    const original = await queue.getJob(response.id);
    await original?.remove();

    const before = await owner`
      SELECT completed_at FROM message_dispatches WHERE message_id = ${response.id}`;
    expect(before[0]?.completed_at).toBeNull();
    expect(await smsQueued.enqueuePending(tenantId)).toBeGreaterThanOrEqual(1);

    await queue.resume();
    await waitFor(
      async () => (await messageStatus(response.id)) === "accepted",
    );
    expect(await commitCount(response.id)).toBe(1);
  });

  it("worker retry after a crash between provider-ack and tx2 never double-commits", async () => {
    // Seed via the inline path so the message is already accepted+committed once…
    const response = await smsInline.send(sendInput("+233209999002"));
    expect(response.status).toBe("accepted");
    expect(await commitCount(response.id)).toBe(1);

    // …then replay the worker step, as BullMQ would after a crash-mid-job.
    const replay = await smsQueued.processQueuedSend({
      input: sendInput("+233209999002"),
      prepared: { messageId: response.id, encoding: "gsm7", segments: 1 },
    });
    expect(replay.status).toBe("accepted"); // terminal-freeze reports the recorded status
    expect(await commitCount(response.id)).toBe(1); // still exactly one commit
  });

  it("queue disabled → inline fallback returns the provider outcome in-response", async () => {
    const response = await smsInline.send(sendInput("+233209999003"));
    expect(response.status).toBe("accepted");
    expect(await commitCount(response.id)).toBe(1);
  });
});
