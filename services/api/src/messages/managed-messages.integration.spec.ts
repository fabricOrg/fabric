// ============================================================================================
// SDK-005 — managed sends over the public API against a real migrated DB. Proves the persistence
// boundary: POST /v1/message-deliveries persists ONE delivery + attempt + message per
// Idempotency-Key; an identical replay returns the same delivery without a second send, reserve,
// or outbox event; the same key with a different payload 409s; and limits.max_cost fails closed
// before any write. tier: test:integration.
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
import {
  cleanManagedTenant,
  seedManagedTenant,
} from "./managed-messages.spec-harness.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;
process.env.REDIS_QUEUE_URL = "";
process.env.MAINTENANCE_CRON_ENABLED = "false";
// CI has no tenant-token secret; the dual-authority test mints a real token in-process.
process.env.TENANT_TOKEN_SECRET ??= "integration-test-tenant-token-secret";

describeDb(
  "SDK-005 managed message deliveries (idempotent sandbox sends)",
  () => {
    const owner = postgres(superUrl ?? "", { max: 2 });
    const db = createAppDb(appUrl ?? "");
    const tenantId = randomUUID();
    const rawKey = `sk_test_${randomUUID().replace(/-/g, "")}${"0".repeat(8)}`;
    let applicationId = "";
    let environmentId = "";
    let app: NestFastifyApplication;

    const payload = {
      key: "order.shipped",
      to: "+233200000042",
      data: { name: "Ada", count: 2 },
      currency: "GHS",
      reference: "order-42",
      metadata: { source: "integration" },
    };

    async function counts() {
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

    function send(body: unknown, idempotencyKey?: string) {
      return app.inject({
        method: "POST",
        url: "/v1/message-deliveries",
        headers: {
          authorization: `Bearer ${rawKey}`,
          "content-type": "application/json",
          ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        },
        payload: body as Record<string, unknown>,
      });
    }

    beforeAll(async () => {
      process.env.DATABASE_URL_APP = appUrl;
      const seeded = await seedManagedTenant({ owner, db, tenantId, rawKey });
      applicationId = seeded.applicationId;
      environmentId = seeded.environmentId;
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
      await cleanManagedTenant(owner, tenantId);
      await Promise.all([owner.end(), db.end()]);
    });

    it("persists one delivery + attempt + message and replays byte-for-byte on the same key", async () => {
      const first = await send(payload, "send-001");
      expect(first.statusCode).toBe(202);
      const delivery = (first.json() as { delivery: Record<string, unknown> })
        .delivery;
      expect(delivery).toMatchObject({
        key: "order.shipped",
        environment: "sandbox",
        locale: "en",
        channel: "sms",
        reference: "order-42",
        metadata: { source: "integration" },
      });
      // Sandbox resolves inline (virtual provider, no queue), so the shared transition core has
      // already reconciled the message outcome onto the delivery + attempt: status propagated,
      // resource_version bumped past the initial `accepted`, and the attempt carries the real cost.
      expect(delivery.status).toBe("delivered");
      expect(delivery.resource_version as number).toBeGreaterThan(1);
      expect(delivery.cost).toMatchObject({ minor: "3", currency: "GHS" });
      const attempts = delivery.attempts as Array<Record<string, unknown>>;
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({
        ordinal: 1,
        channel: "sms",
        status: "delivered",
        cost: { minor: "3", currency: "GHS" },
      });

      const afterFirst = await counts();
      expect(afterFirst).toMatchObject({
        messages: 1,
        deliveries: 1,
        attempts: 1,
      });

      const replay = await send(payload, "send-001");
      expect(replay.statusCode).toBe(202);
      const replayed = (replay.json() as { delivery: { id: string } }).delivery;
      // Deterministic delivery id: same tenant/app/env/key → the same resource, not a sibling.
      expect(replayed.id).toBe(delivery.id);
      // The load-bearing guarantee: no second message, reserve, attempt, or outbox event.
      expect(await counts()).toEqual(afterFirst);
    });

    it("retrieves the delivery by id with its attempt history", async () => {
      const sent = await send(payload, "send-001");
      const id = (sent.json() as { delivery: { id: string } }).delivery.id;
      const response = await app.inject({
        method: "GET",
        url: `/v1/message-deliveries/${id}`,
        headers: { authorization: `Bearer ${rawKey}` },
      });
      expect(response.statusCode).toBe(200);
      const delivery = (
        response.json() as {
          delivery: { id: string; attempts: unknown[] };
        }
      ).delivery;
      expect(delivery.id).toBe(id);
      expect(delivery.attempts).toHaveLength(1);
    });

    it("collapses concurrent identical sends onto one delivery", async () => {
      const key = "send-concurrent";
      const [a, b, c] = await Promise.all([
        send(payload, key),
        send(payload, key),
        send(payload, key),
      ]);
      // One accepted delivery per caller (FOR UPDATE replay probe + ON CONFLICT insert). `body`
      // rides along so a failure names what threw — this has flaked in CI as a bare 500.
      for (const r of [a, b, c])
        expect({ s: r.statusCode, b: r.body }).toMatchObject({ s: 202 });
      const ids = new Set(
        [a, b, c].map(
          (response) =>
            (response.json() as { delivery: { id: string } }).delivery.id,
        ),
      );
      expect(ids.size).toBe(1);
      const rows = await owner`
        SELECT count(*)::int AS n FROM message_deliveries
        WHERE tenant_id = ${tenantId} AND idempotency_key = ${key}`;
      expect(Number(rows[0]?.n)).toBe(1);
      const attempts = await owner`
        SELECT count(*)::int AS n FROM message_delivery_attempts
        WHERE tenant_id = ${tenantId}
          AND delivery_id = ${[...ids][0] ?? ""}`;
      expect(Number(attempts[0]?.n)).toBe(1);
    });

    it("lists the environment's deliveries newest-first without recipient PII", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/message-deliveries",
        headers: { authorization: `Bearer ${rawKey}` },
      });
      expect(response.statusCode).toBe(200);
      const { deliveries } = response.json() as {
        deliveries: Array<Record<string, unknown>>;
      };
      // send-001 + the concurrent-race delivery from the earlier tests.
      expect(deliveries.length).toBeGreaterThanOrEqual(2);
      const times = deliveries.map((d) => String(d.created_at));
      expect([...times].sort().reverse()).toEqual(times);
      for (const delivery of deliveries) {
        expect(delivery.key).toBe("order.shipped");
        expect(delivery).not.toHaveProperty("recipient");
        expect(delivery).not.toHaveProperty("attempts");
      }
    });

    it("reports webhook fan-out status for a delivery's events", async () => {
      const getWebhooks = (deliveryId: string) =>
        app.inject({
          method: "GET",
          url: `/v1/message-deliveries/${deliveryId}/webhooks`,
          headers: { authorization: `Bearer ${rawKey}` },
        });
      const sent = await send(payload, "send-001");
      const id = (sent.json() as { delivery: { id: string } }).delivery.id;
      // No endpoints registered → observable, just empty.
      const before = await getWebhooks(id);
      expect(before.statusCode).toBe(200);
      expect((before.json() as { webhooks: unknown[] }).webhooks).toEqual([]);

      // Register an endpoint and fan the acceptance event out to it (the poller's job — its own
      // worker specs cover fan-out; here we assert the delivery-scoped observability read).
      const [event] = await owner`
        SELECT id FROM outbox_events
        WHERE tenant_id = ${tenantId} AND payload->>'message_id' = ${id}
        ORDER BY created_at LIMIT 1`;
      if (!event) throw new Error("acceptance event missing");
      const [endpoint] = await owner`
        INSERT INTO webhook_endpoints (tenant_id, application_id, environment_id, url, secret, status)
        VALUES (${tenantId}, ${applicationId}, ${environmentId},
                'https://example.test/hooks', 'whsec_test_secret', 'active')
        RETURNING id`;
      await owner`
        INSERT INTO webhook_deliveries (
          tenant_id, application_id, environment_id, event_id, endpoint_id,
          state, attempts, delivered_at, last_http_status
        ) VALUES (
          ${tenantId}, ${applicationId}, ${environmentId}, ${event.id},
          ${endpoint?.id}, 'delivered', 1, now(), 200
        )`;

      const response = await getWebhooks(id);
      expect(response.statusCode).toBe(200);
      const { webhooks } = response.json() as {
        webhooks: Array<Record<string, unknown>>;
      };
      expect(webhooks).toHaveLength(1);
      expect(webhooks[0]).toMatchObject({
        endpoint_url: "https://example.test/hooks",
        state: "delivered",
        attempts: 1,
        last_http_status: 200,
      });
      // Containment: an unknown delivery 404s rather than leaking cross-scope rows.
      expect((await getWebhooks(randomUUID())).statusCode).toBe(404);
    });

    it("serves the dashboard tenant token only with explicit app/env scope", async () => {
      const { TenantTokenService } = await import(
        "../api-keys/tenant-token.service.js"
      );
      const { token } = app.get(TenantTokenService).mint(tenantId);
      const auth = { authorization: `Bearer ${token}` };
      // A tenant token has no application scope — it must name the environment.
      const missing = await app.inject({
        method: "GET",
        url: "/v1/message-deliveries",
        headers: auth,
      });
      expect(missing.statusCode).toBe(400);
      expect(missing.json()).toMatchObject({
        error: { code: "environment_id_required" },
      });
      const listed = await app.inject({
        method: "GET",
        url: `/v1/message-deliveries?environment_id=${environmentId}`,
        headers: auth,
      });
      expect(listed.statusCode).toBe(200);
      const first = (listed.json() as { deliveries: Array<{ id: string }> })
        .deliveries[0];
      if (!first) throw new Error("expected at least one delivery");
      const detail = await app.inject({
        method: "GET",
        url: `/v1/message-deliveries/${first.id}?application_id=${applicationId}&environment_id=${environmentId}`,
        headers: auth,
      });
      expect(detail.statusCode).toBe(200);
      const delivery = (detail.json() as { delivery: { attempts: unknown[] } })
        .delivery;
      expect(delivery.attempts).toHaveLength(1);
    });

    it("409s when the same Idempotency-Key carries a different request", async () => {
      const before = await counts();
      const response = await send(
        { ...payload, data: { name: "Grace", count: 9 } },
        "send-001",
      );
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: { code: "idempotency_conflict" },
      });
      expect(await counts()).toEqual(before);
    });

    it("requires an Idempotency-Key header", async () => {
      const response = await send(payload);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: { code: "idempotency_key_required" },
      });
    });

    it("fails closed on limits.max_cost before any write", async () => {
      const before = await counts();
      const response = await send(
        {
          ...payload,
          limits: { max_cost: { minor: "1", currency: "GHS" } },
        },
        "send-cost-cap",
      );
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: { code: "max_cost_exceeded" },
      });
      expect(await counts()).toEqual(before);
    });

    it("rejects a validation failure with a path-coded error", async () => {
      const response = await send(
        { ...payload, data: { count: 2 } },
        "send-invalid",
      );
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: { code: "missing_required" },
      });
    });
  },
);
