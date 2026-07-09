import { randomUUID } from "node:crypto";
import {
  accounts,
  createAppDb,
  createProvisioningDb,
  type TenantId,
} from "@app/db";
import { credit } from "@app/wallet";
import { HttpException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RequestTenant } from "../api-keys/api-key.guard.js";
import type { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import type { AutoTopupService } from "../payments/auto-topup.service.js";
import { QueueService } from "../queue/queue.service.js";
import { SmsController } from "../sms/sms.controller.js";
import { SmsService } from "../sms/sms.service.js";
import { IdempotencyService } from "./idempotency.service.js";

/**
 * CLIENT IDEMPOTENCY — integration spec (finding 3 of the architecture remediation).
 * The exact hole being closed: a client retry of POST /v1/sms/send used to mint a NEW message +
 * NEW reservation (the engine's internal keys are keyed on the server-generated id). Proven here
 * end-to-end through the REAL controller path against a real migrated Postgres:
 *   - two identical CONCURRENT sends with one key → exactly ONE message + ONE reservation
 *   - a sequential retry replays the stored response (same message id, no new charge)
 *   - same key + different body → 409 idempotency_key_reused
 *   - a failed request releases the key so the client may retry it
 */

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP ?? superUrl;
const describeDb = superUrl ? describe : describe.skip;

describeDb("client Idempotency-Key on POST /v1/sms/send", () => {
  const provisioning = createProvisioningDb(superUrl ?? "", { max: 2 });
  const appDb = createAppDb(appUrl ?? "");
  const owner = postgres(superUrl ?? "", { max: 1 });

  const config = {
    get: () => undefined, // FakeProvider, defaults everywhere
  } as unknown as ConfigService;
  // Togglable: lets a test force a failure AFTER the idempotency claim (inside SmsService.send).
  let sendingPaused = false;
  const killSwitch = {
    isPaused: async () => sendingPaused,
  } as unknown as KillSwitchService;
  const autoTopup = {
    maybeAutoTopUp: async () => undefined,
  } as unknown as AutoTopupService;

  // Queue disabled (no REDIS_QUEUE_URL) → inline send path, as before finding 7.
  const sms = new SmsService(
    appDb,
    autoTopup,
    killSwitch,
    config,
    new QueueService(config),
  );
  const idempotency = new IdempotencyService(appDb);
  const controller = new SmsController(sms, idempotency);

  const tenantId = randomUUID() as TenantId;
  const tenant: RequestTenant = { id: tenantId, scopes: ["sms:send"] };
  const req = { tenant };
  const CREDIT = 100_000n;

  const sendBody = {
    to: "+233201234567",
    sender_id: "FABRIC",
    body: "idempotency test",
    currency: "GHS",
  };

  beforeAll(async () => {
    await provisioning.db.insert(accounts).values({
      id: tenantId,
      name: "Idempotency Test",
      slug: `idem-${tenantId}`,
    });
    await appDb.withTenant(tenantId, (tx) =>
      credit(tx, {
        currency: "GHS",
        amountMinor: CREDIT,
        idempotencyKey: `topup:idem-${tenantId}`,
      }),
    );
  });

  afterAll(async () => {
    await owner`DELETE FROM api_idempotency_keys WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM messages WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM ledger_entries WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM ledger_transactions WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM ledger_accounts WHERE tenant_id = ${tenantId}`;
    await owner`DELETE FROM accounts WHERE id = ${tenantId}`;
    await Promise.all([provisioning.end(), appDb.end(), owner.end()]);
  });

  async function messageCount(): Promise<number> {
    const rows = await owner`
      SELECT count(*)::int AS n FROM messages WHERE tenant_id = ${tenantId}`;
    return Number(rows[0]?.n);
  }

  /** Distinct reserve MOVEMENTS (one movement = 2 balanced legs, so count txns not rows). */
  async function reserveCount(): Promise<number> {
    const rows = await owner`
      SELECT count(DISTINCT txn_id)::int AS n FROM ledger_entries
      WHERE tenant_id = ${tenantId} AND reason = 'sms_reserve'`;
    return Number(rows[0]?.n);
  }

  it("sequential retry with the same key replays: one message, one reservation, same id", async () => {
    const key = `key-${randomUUID()}`;
    const before = await messageCount();

    const first = await controller.send(req, sendBody, key);
    const retry = await controller.send(req, sendBody, key);

    expect(retry.id).toBe(first.id);
    expect(retry.request_id).toBe(first.request_id); // stored response replayed verbatim
    expect(await messageCount()).toBe(before + 1);
  });

  it("concurrent identical sends with one key produce exactly one message + one reservation", async () => {
    const key = `key-${randomUUID()}`;
    const msgsBefore = await messageCount();
    const reservesBefore = await reserveCount();

    const results = await Promise.allSettled([
      controller.send(req, sendBody, key),
      controller.send(req, sendBody, key),
      controller.send(req, sendBody, key),
    ]);

    // Exactly one winner ran the pipeline; losers either replayed the same id (if the winner
    // finished first) or got 409 idempotency_in_flight — NEVER a second message/charge.
    const fulfilled = results.filter(
      (
        r,
      ): r is PromiseFulfilledResult<
        Awaited<ReturnType<SmsController["send"]>>
      > => r.status === "fulfilled",
    );
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const ids = new Set(fulfilled.map((r) => r.value.id));
    expect(ids.size).toBe(1);
    for (const r of results) {
      if (r.status === "rejected") {
        expect(r.reason).toBeInstanceOf(HttpException);
        expect((r.reason as HttpException).getStatus()).toBe(409);
      }
    }
    expect(await messageCount()).toBe(msgsBefore + 1);
    expect(await reserveCount()).toBe(reservesBefore + 1);
  });

  it("same key + different body → 409 idempotency_key_reused", async () => {
    const key = `key-${randomUUID()}`;
    await controller.send(req, sendBody, key);

    await expect(
      controller.send(req, { ...sendBody, body: "different body" }, key),
    ).rejects.toSatisfy(
      (e) => e instanceof HttpException && e.getStatus() === 409,
    );
  });

  it("a failed request releases the key so the same key can retry", async () => {
    const key = `key-${randomUUID()}`;
    // Fail AFTER the idempotency claim: the kill-switch check lives inside SmsService.send.
    sendingPaused = true;
    try {
      await expect(controller.send(req, sendBody, key)).rejects.toBeInstanceOf(
        HttpException,
      );
    } finally {
      sendingPaused = false;
    }

    // The pending row was released — the SAME key now succeeds (not 409 in_flight).
    const ok = await controller.send(req, sendBody, key);
    expect(ok.id).toBeTruthy();
  });

  it("no header → un-keyed path still works (two sends = two messages)", async () => {
    const before = await messageCount();
    await controller.send(req, sendBody, undefined);
    await controller.send(req, sendBody, undefined);
    expect(await messageCount()).toBe(before + 2);
  });
});
