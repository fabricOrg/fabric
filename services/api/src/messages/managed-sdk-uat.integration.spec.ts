// ============================================================================================
// SDK-005 outcome evidence — the sandbox send-to-webhook workflow through the REAL SDK over real
// HTTP. The @fabric-messaging/sdk client sends a released definition by key, the outbox fans out
// to a registered endpoint, the SDK verifies the signatures and parses TYPED events (acceptance +
// terminal), and delivery, attempt, wallet, and webhook records reconcile to ONE logical message.
// tier: test:integration (real Postgres; real HTTP listener; no Redis).
// ============================================================================================

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createAppDb } from "@app/db";
import { Fabric, type KnownWebhookEvent } from "@fabric-messaging/sdk";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { WebhookDeliveryService } from "../webhooks/webhook-delivery.service.js";
import {
  cleanManagedTenant,
  seedManagedTenant,
} from "./managed-messages.spec-harness.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;
process.env.REDIS_QUEUE_URL = "";
process.env.MAINTENANCE_CRON_ENABLED = "false";
process.env.TENANT_TOKEN_SECRET ??= "integration-test-tenant-token-secret";
// The receiver lives on 127.0.0.1 — allow it explicitly (prod policy stays https-only/public).
process.env.WEBHOOK_ALLOW_PRIVATE_NETWORKS = "true";

const WEBHOOK_SECRET = "whsec_uat_integration_secret";

describeDb("SDK-005 UAT — SDK send → typed webhook consumption", () => {
  const owner = postgres(superUrl ?? "", { max: 2 });
  const db = createAppDb(appUrl ?? "");
  const tenantId = randomUUID();
  const rawKey = `sk_test_${randomUUID().replace(/-/g, "")}${"0".repeat(8)}`;
  const received: Array<{ body: string; signature: string | undefined }> = [];
  let app: NestFastifyApplication;
  let receiver: Server;
  let fabric: Fabric;
  let applicationId = "";
  let environmentId = "";

  beforeAll(async () => {
    process.env.DATABASE_URL_APP = appUrl;
    const seeded = await seedManagedTenant({ owner, db, tenantId, rawKey });
    applicationId = seeded.applicationId;
    environmentId = seeded.environmentId;

    receiver = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        received.push({
          body: Buffer.concat(chunks).toString("utf8"),
          signature: request.headers["fabric-signature"] as string | undefined,
        });
        response.statusCode = 200;
        response.end("ok");
      });
    });
    await new Promise<void>((resolve) =>
      receiver.listen(0, "127.0.0.1", resolve),
    );
    const receiverPort = (receiver.address() as AddressInfo).port;
    await owner`
      INSERT INTO webhook_endpoints (tenant_id, application_id, environment_id, url, secret, status)
      VALUES (${tenantId}, ${applicationId}, ${environmentId},
              ${`http://127.0.0.1:${receiverPort}/hooks`}, ${WEBHOOK_SECRET}, 'active')`;

    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter(),
      { logger: false },
    );
    await app.init();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const apiUrl = await app.getUrl();
    fabric = new Fabric({
      apiKey: rawKey,
      baseUrl: apiUrl.replace("[::1]", "127.0.0.1"),
    });
  });

  afterAll(async () => {
    await app?.close();
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
    await cleanManagedTenant(owner, tenantId);
    await Promise.all([owner.end(), db.end()]);
  });

  it("completes send → fan-out → verified typed events → reconciled records", async () => {
    // 1. Send by stable key through the real SDK over real HTTP.
    const sent = await fabric.messages.send("order.shipped", {
      to: "+233200000042",
      data: { name: "Ada", count: 2 },
      reference: "uat-order-1",
      idempotencyKey: "uat-send-001",
    });
    expect(sent.statusCode).toBe(202);
    expect(sent.data.status).toBe("delivered"); // sandbox resolves inline
    expect(sent.data.cost).toEqual({ minor: "3", currency: "GHS" });

    // 2. Drive the standing delivery worker (its cron is the production trigger).
    const worker = app.get(WebhookDeliveryService);
    const sweep = await worker.deliverPending();
    expect(sweep.delivered).toBeGreaterThanOrEqual(2);

    // 3. The SDK verifies every signature and yields TYPED events.
    expect(received.length).toBeGreaterThanOrEqual(2);
    const events = received.map(({ body, signature }) =>
      fabric.webhooks.verify({
        payload: body,
        signature,
        secret: WEBHOOK_SECRET,
      }),
    );
    const types = events.map((event) => event.type);
    expect(types).toContain("message.accepted");
    expect(types).toContain("message.delivered"); // terminal, mapped from message.updated
    const accepted = events.find(
      (
        event,
      ): event is Exclude<KnownWebhookEvent, { type: "message.inbound" }> =>
        event.type === "message.accepted",
    );
    if (!accepted) throw new Error("acceptance event missing");
    expect(accepted.data.messageId).toBe(sent.data.id);
    // A tampered payload is refused — the signature is load-bearing, not decorative.
    const sample = received[0];
    if (!sample) throw new Error("no webhook received");
    expect(() =>
      fabric.webhooks.verify({
        payload: `${sample.body} `,
        signature: sample.signature,
        secret: WEBHOOK_SECRET,
      }),
    ).toThrow();

    // 4. Reconciliation: SDK retrieval, wallet, and rows agree on ONE logical message.
    const retrieved = await fabric.messages.retrieveDelivery(sent.data.id);
    expect(retrieved.data.status).toBe("delivered");
    expect(retrieved.data.attempts).toHaveLength(1);
    const counts = await owner`
      SELECT
        (SELECT count(*)::int FROM messages WHERE tenant_id = ${tenantId}) AS messages,
        (SELECT count(*)::int FROM message_deliveries WHERE tenant_id = ${tenantId}) AS deliveries,
        (SELECT count(*)::int FROM message_delivery_attempts WHERE tenant_id = ${tenantId}) AS attempts`;
    expect(counts[0]).toMatchObject({
      messages: 1,
      deliveries: 1,
      attempts: 1,
    });
    // Sandbox money posture: reserved through the real wallet path, refunded at the terminal.
    const [balance] = await owner`
      SELECT balance_minor FROM ledger_accounts
      WHERE tenant_id = ${tenantId} AND kind = 'customer' AND currency = 'GHS'`;
    expect(String(balance?.balance_minor)).toBe("10000");
  });
});
