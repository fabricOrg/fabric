// ============================================================================================
// SDK-005-AC05 (managed-specific negatives) — a pre-acceptance gate must return a STRUCTURED error
// and leave NOTHING behind: no delivery, attempt, message, or outbox event. The shared `sms.send`
// compliance suites already cover the gates in the direct path; these prove the MANAGED path routes
// through the same assessment and fails closed before any write.
//
// Covered here (deterministic): recipient opt-out (STOP/full suppression) and an exhausted sandbox
// allowance. Insufficient funds is no longer reachable on a sandbox key — that path stopped touching
// the wallet when allowances landed.
// Quiet hours is deliberately NOT driven through HTTP — `promoWindowOpen` reads the wall clock and
// the preview service does not accept an injected `now`, so an integration test for it would pass or
// fail by time of day. It stays proven at the pure-function level in `consent/consent.window.spec`.
// Sender registration cannot block a sandbox managed send by design (`virtual: true` short-circuits
// the sender check), so there is no sandbox negative to assert.
// tier: test:integration.
// ============================================================================================

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createAppDb } from "@app/db";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { ConsentService } from "../consent/consent.service.js";
import {
  cleanManagedTenant,
  seedManagedTenant,
} from "./managed-messages.spec-harness.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;
process.env.REDIS_QUEUE_URL = "";
process.env.MAINTENANCE_CRON_ENABLED = "false";
// One segment a day, so the allowance gate is reachable in a test instead of after 100 sends. Read
// at SandboxAllowanceService construction, so it must be set before the module is created below.
process.env.SANDBOX_SMS_SEGMENTS_PER_DAY = "1";
process.env.TENANT_TOKEN_SECRET ??= "integration-test-tenant-token-secret";

describeDb("SDK-005 managed sends — pre-acceptance gates fail closed", () => {
  const owner = postgres(superUrl ?? "", { max: 2 });
  const db = createAppDb(appUrl ?? "");

  const fundedTenant = randomUUID();
  const brokeTenant = randomUUID();
  const fundedKey = `sk_test_${randomUUID().replace(/-/g, "")}${"0".repeat(8)}`;
  const brokeKey = `sk_test_${randomUUID().replace(/-/g, "")}${"1".repeat(8)}`;
  let app: NestFastifyApplication;

  const OPTED_OUT = "+233200000077";
  const SOLVENT_RECIPIENT = "+233200000088";

  async function counts(tenantId: string) {
    const q = async (table: string) => {
      const rows = await owner.unsafe(
        `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
        [tenantId],
      );
      return (rows[0] as unknown as { n: number }).n;
    };
    return {
      messages: await q("messages"),
      deliveries: await q("message_deliveries"),
      attempts: await q("message_delivery_attempts"),
      outbox: await q("outbox_events"),
    };
  }

  function send(apiKey: string, to: string, idempotencyKey: string) {
    return app.inject({
      method: "POST",
      url: "/v1/message-deliveries",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      payload: {
        key: "order.shipped",
        to,
        data: { name: "Ada", count: 2 },
        currency: "GHS",
      },
    });
  }

  beforeAll(async () => {
    process.env.DATABASE_URL_APP = appUrl;
    await seedManagedTenant({
      owner,
      db,
      tenantId: fundedTenant,
      rawKey: fundedKey,
    });
    // fundMinor is now incidental: a sandbox key never reaches the wallet. The allowance capped to
    // one segment above is what refuses the second send.
    await seedManagedTenant({
      owner,
      db,
      tenantId: brokeTenant,
      rawKey: brokeKey,
      fundMinor: 1n,
      // sms:send too, so the same exhausted allowance drives the DIRECT route as well.
      scopes: ["messages:send", "messages:read", "sms:send"],
    });
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter(),
      { logger: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    await cleanManagedTenant(owner, fundedTenant);
    await cleanManagedTenant(owner, brokeTenant);
    await db.end();
    await owner.end();
  });

  it("refuses a suppressed recipient and writes nothing", async () => {
    // scope "all" is the customer's full-suppression list — it blocks transactional too, which the
    // seeded definition is. A "promotional" scope would (correctly) let this transactional send pass.
    const consent = new ConsentService(db);
    await consent.add(
      fundedTenant,
      { msisdn: OPTED_OUT, scope: "all" },
      "stop",
    );

    const before = await counts(fundedTenant);
    const response = await send(fundedKey, OPTED_OUT, `optout-${randomUUID()}`);

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; param?: string } };
    expect(body.error.code).toBe("recipient_opted_out");
    expect(await counts(fundedTenant)).toEqual(before);
  });

  it("refuses an exhausted sandbox allowance and writes nothing", async () => {
    // This asserted 402 insufficient_funds on a 1-minor-unit wallet until sandbox allowances landed.
    // A sandbox key routes to the virtual phone (ADR-0004), and that path no longer consults the
    // wallet — so the underfunded state is unreachable here and the gate that actually fires is the
    // daily allowance. The suite's subject is unchanged: a pre-acceptance gate must fail closed.
    // Spend the single segment this workspace is allowed, so the assertion is about the gate rather
    // than about which test ran first.
    await send(brokeKey, SOLVENT_RECIPIENT, `warm-${randomUUID()}`);

    const before = await counts(brokeTenant);
    const response = await send(
      brokeKey,
      SOLVENT_RECIPIENT,
      `broke-${randomUUID()}`,
    );

    // 429 + the declared `rate_limit_error` category — NOT an opaque 500. Same regression guard the
    // 402 case carried: the gate error must stay mapped so an SDK can branch on it.
    expect(response.statusCode).toBe(429);
    const body = response.json() as { error: { type: string; code: string } };
    expect(body.error.type).toBe("rate_limit_error");
    expect(body.error.code).toBe("sandbox_daily_limit_exceeded");
    // Fails closed: the gate rejects inside the acceptance transaction, so no partial row survives —
    // not a message, not an attempt, and no acceptance event a consumer could observe.
    expect(await counts(brokeTenant)).toEqual(before);
  });

  it("returns the same 429 on the direct sms route, not a 500", async () => {
    // The direct path carried the identical unmapped gate error. Mapped at the controller boundary
    // so `SmsService` keeps throwing the domain error for ManagedMessagesService. The allowance is
    // already spent by the case above — same workspace, same daily bucket.
    const before = await counts(brokeTenant);
    const response = await app.inject({
      method: "POST",
      url: "/v1/sms/messages",
      headers: {
        authorization: `Bearer ${brokeKey}`,
        "content-type": "application/json",
      },
      payload: {
        to: SOLVENT_RECIPIENT,
        sender_id: "FABRIC",
        body: "Direct send against an underfunded wallet.",
      },
    });

    expect(response.statusCode).toBe(429);
    const body = response.json() as { error: { type: string; code: string } };
    expect(body.error.type).toBe("rate_limit_error");
    expect(body.error.code).toBe("sandbox_daily_limit_exceeded");
    expect(await counts(brokeTenant)).toEqual(before);
  });

  it("still accepts a solvent send to a recipient who did not opt out", async () => {
    // Guards the negatives above from passing for the wrong reason (e.g. a broken definition).
    const response = await send(
      fundedKey,
      SOLVENT_RECIPIENT,
      `happy-${randomUUID()}`,
    );
    expect(response.statusCode).toBe(202);
    const after = await counts(fundedTenant);
    expect(after.deliveries).toBe(1);
    expect(after.messages).toBe(1);
  });
});
