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
import { credit } from "@app/wallet";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashApiKey } from "../api-keys/api-key.crypto.js";
import { AppModule } from "../app.module.js";
import { ApplicationsService } from "../applications/applications.service.js";
import type { AuditService } from "../audit/audit.service.js";
import { MessageDefinitionsService } from "../message-definitions/message-definitions.service.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;
process.env.REDIS_QUEUE_URL = "";
process.env.MAINTENANCE_CRON_ENABLED = "false";

describeDb(
  "SDK-005 managed message deliveries (idempotent sandbox sends)",
  () => {
    const owner = postgres(superUrl ?? "", { max: 2 });
    const db = createAppDb(appUrl ?? "");
    const tenantId = randomUUID();
    const rawKey = `sk_test_${"5".repeat(40)}`;
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
      await owner`
      INSERT INTO accounts (id, name, slug)
      VALUES (${tenantId}, 'Managed Sends', ${`managed-${tenantId}`})`;
      const apps = new ApplicationsService(db);
      const created = await apps.create(tenantId, {
        name: "Default",
        slug: "default",
      });
      applicationId = created.id;
      environmentId =
        created.environments.find((e) => e.type === "sandbox")?.id ?? "";
      const audit = {
        record: async () => undefined,
      } as unknown as AuditService;
      const defs = new MessageDefinitionsService(db, audit);
      const definition = await defs.create(tenantId, {
        key: "order.shipped",
        application_id: applicationId,
        variable_schema: {
          type: "object",
          properties: {
            name: { type: "string" },
            count: { type: "integer", minimum: 0 },
          },
          required: ["name"],
        },
        content: {
          body: "Hi {{name}}, {{count}} orders.",
          class: "transactional",
          locales: {},
        },
        default_locale: "en",
        sender_id: "FABRIC",
      });
      await defs.publish(
        tenantId,
        definition.definition.id,
        {
          environment: "sandbox",
          version_id: definition.latest_version?.id ?? "",
        },
        "key_test",
      );
      await owner`
      INSERT INTO api_keys (
        tenant_id, application_id, environment_id, prefix, key_hash, env, scopes, status
      ) VALUES (
        ${tenantId}, ${applicationId}, ${environmentId}, 'sk_test_manag',
        ${hashApiKey(rawKey)}, 'test', '["messages:send","messages:read"]'::jsonb, 'active'
      )`;
      await db.withTenant(tenantId, (tx) =>
        credit(tx, {
          currency: "GHS",
          amountMinor: 10_000n,
          idempotencyKey: `topup:managed-${tenantId}`,
        }),
      );
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
      await owner`DELETE FROM outbox_events WHERE tenant_id = ${tenantId}`;
      await owner`DELETE FROM message_delivery_attempts WHERE tenant_id = ${tenantId}`;
      await owner`DELETE FROM message_deliveries WHERE tenant_id = ${tenantId}`;
      await owner`DELETE FROM messages WHERE tenant_id = ${tenantId}`;
      await owner`DELETE FROM message_definition_releases WHERE tenant_id = ${tenantId}`;
      await owner`DELETE FROM message_definition_sender_bindings WHERE tenant_id = ${tenantId}`;
      await owner`DELETE FROM message_definition_versions WHERE tenant_id = ${tenantId}`;
      await owner`DELETE FROM message_definitions WHERE tenant_id = ${tenantId}`;
      await owner`DELETE FROM ledger_entries WHERE tenant_id = ${tenantId}`;
      await owner`DELETE FROM ledger_transactions WHERE tenant_id = ${tenantId}`;
      await owner`DELETE FROM ledger_accounts WHERE tenant_id = ${tenantId}`;
      await owner`DELETE FROM api_keys WHERE tenant_id = ${tenantId}`;
      await owner`DELETE FROM applications WHERE tenant_id = ${tenantId}`;
      await owner`DELETE FROM accounts WHERE id = ${tenantId}`;
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
      const attempts = delivery.attempts as Array<Record<string, unknown>>;
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({ ordinal: 1, channel: "sms" });

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
