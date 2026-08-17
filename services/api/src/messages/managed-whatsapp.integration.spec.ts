import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { createAppDb } from "@app/db";
import { DEFAULT_WHATSAPP_BASE_RATES } from "@app/domain";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { PiiVaultService } from "../privacy/pii-vault.service.js";
import { jsonBody } from "../testing/response.js";
import {
  cleanManagedTenant,
  seedManagedTenant,
  seedManagedWhatsappDefinition,
} from "./managed-messages.spec-harness.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;
process.env.REDIS_QUEUE_URL = "";
process.env.MAINTENANCE_CRON_ENABLED = "false";
process.env.TENANT_TOKEN_SECRET ??= "integration-test-tenant-token-secret";

/**
 * Managed WhatsApp acceptance (ADR-0014). The properties under test are the ones a WhatsApp definition
 * can get wrong that SMS and email cannot: the binding resolves to POSITIONAL parameters in template
 * order, a locale selects a different Meta template rather than different text, and the accepted row is
 * indistinguishable from a direct send's so one worker dispatches both.
 *
 * NOT tested here: the `platform.whatsapp_sending` kill-switch gate on acceptance. Toggling it would
 * mutate a shared control-plane singleton while whatsapp.integration.spec.ts reads the same key in a
 * parallel worker — a flaky test that fails other specs, not a safety net. The gate is the same
 * `assertWhatsappSendingEnabled` the direct path uses and is covered there.
 */
describeDb("managed WhatsApp acceptance", () => {
  const owner = postgres(superUrl ?? "", { max: 2 });
  const db = createAppDb(appUrl ?? "");
  const tenantId = randomUUID();
  const rawKey = `sk_test_${randomUUID().replace(/-/g, "")}${"0".repeat(8)}`;
  let applicationId = "";
  let environmentId = "";
  let app: NestFastifyApplication;
  let vault: PiiVaultService;

  const payload = {
    key: "order.whatsapp",
    to: "+233200000042",
    data: { name: "Ada", count: 2 },
    currency: "GHS",
    reference: "wa-order-42",
    metadata: { source: "integration" },
  };

  function send(body: Record<string, unknown>, idempotencyKey: string) {
    return app.inject({
      method: "POST",
      url: "/v1/message-deliveries",
      headers: {
        authorization: `Bearer ${rawKey}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      payload: body,
    });
  }

  const previewPayload = {
    key: "order.whatsapp",
    data: { name: "Ada", count: 2 },
    currency: "GHS",
  };

  function preview(body: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: "/v1/messages/preview",
      headers: {
        authorization: `Bearer ${rawKey}`,
        "content-type": "application/json",
      },
      payload: body,
    });
  }

  async function counts() {
    const q = async (table: string) => {
      const rows = await owner.unsafe(
        `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
        [tenantId],
      );
      return Number(rows[0]?.n ?? 0);
    };
    return {
      smsMessages: await q("messages"),
      whatsappMessages: await q("whatsapp_messages"),
      whatsappDispatches: await q("whatsapp_dispatches"),
      deliveries: await q("message_deliveries"),
      attempts: await q("message_delivery_attempts"),
    };
  }

  /** The binding as the dispatch worker will read it back out of the vault. */
  async function storedContent(messageId: string) {
    const rows = await owner`
      SELECT content_pii_id FROM whatsapp_messages WHERE id = ${messageId}`;
    const piiId = rows[0]?.content_pii_id;
    if (!piiId) throw new Error("whatsapp content pii id missing");
    const raw = await vault.read(tenantId, String(piiId));
    if (!raw) throw new Error("whatsapp content unreadable");
    return JSON.parse(raw) as {
      to: string;
      template_name: string;
      template_language: string;
      template_category: string;
      variables: string[];
    };
  }

  beforeAll(async () => {
    process.env.DATABASE_URL_APP = appUrl;
    const seeded = await seedManagedTenant({
      owner,
      db,
      tenantId,
      rawKey,
      // `sms:read` is what the preview route gates on for EVERY channel — an SMS-era scope name that
      // now also covers email and WhatsApp definition reads (ADR-0005 #6). Named here rather than
      // silently inherited so the wart is visible.
      scopes: ["messages:send", "messages:read", "sms:read"],
    });
    applicationId = seeded.applicationId;
    environmentId = seeded.environmentId;
    await seedManagedWhatsappDefinition({
      owner,
      tenantId,
      applicationId,
      environmentId,
      key: "order.whatsapp",
    });
    await seedManagedWhatsappDefinition({
      owner,
      tenantId,
      applicationId,
      environmentId,
      key: "order.whatsapp.marketing",
      category: "marketing",
    });
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter(),
      { logger: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    vault = app.get(PiiVaultService);
  });

  afterAll(async () => {
    await app?.close();
    await cleanManagedTenant(owner, tenantId);
    await Promise.all([owner.end(), db.end()]);
  });

  it("previews the binding, not a body, with parameters in template order", async () => {
    const response = await preview(previewPayload);
    expect(response.statusCode).toBe(201);
    const body = jsonBody(response) as Record<string, unknown>;
    expect(body).toMatchObject({
      channel: "whatsapp",
      eligible: true,
      // No authored WhatsApp sender exists — the WABA number comes from credentials at dispatch.
      sender: { sender_id: "", status: "not_evaluated" },
      preview: null,
      email_preview: null,
    });
    expect(body.whatsapp_preview).toEqual({
      template_name: "order_shipped",
      template_language: "en_US",
      template_category: "utility",
      // ORDERED, and the order is the definition's `parameters`, not the payload's key order.
      parameters: ["Ada", "2"],
      // The compiled default, read from the constant — restating it broke CI when the price moved.
      cost_minor: String(DEFAULT_WHATSAPP_BASE_RATES.GHS),
      currency: "GHS",
    });
  });

  it("resolves a locale to a different template, and blocks one with none", async () => {
    // Meta stores one template per name+language, so a locale picks a different TEMPLATE ROW. An
    // unsupported locale must therefore block, not quietly fall back to the default language — that
    // would send the wrong language to a customer who asked for another.
    const fr = await preview({ ...previewPayload, locale: "fr" });
    expect(fr.statusCode).toBe(201);
    expect(
      (
        jsonBody(fr) as {
          whatsapp_preview: Record<string, unknown>;
        }
      ).whatsapp_preview,
    ).toMatchObject({
      template_name: "order_shipped",
      template_language: "fr",
    });

    const de = await preview({ ...previewPayload, locale: "de" });
    expect(de.statusCode).toBe(201);
    expect(jsonBody(de)).toMatchObject({
      eligible: false,
      blockers: [{ path: "locale", code: "locale_not_supported" }],
      whatsapp_preview: null,
    });
  });

  it("accepts and persists one managed WhatsApp message", async () => {
    const response = await send(payload, "wa-accept-001");
    expect(response.statusCode).toBe(202);
    const delivery = (
      jsonBody(response) as { delivery: Record<string, unknown> }
    ).delivery;
    expect(delivery).toMatchObject({
      key: "order.whatsapp",
      channel: "whatsapp",
      status: "accepted",
      cost: { minor: String(DEFAULT_WHATSAPP_BASE_RATES.GHS), currency: "GHS" },
    });
    const attempts = delivery.attempts as Array<Record<string, unknown>>;
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      channel: "whatsapp",
      // The public message_id is the SMS resource id; a WhatsApp attempt exposes its own elsewhere.
      message_id: null,
      status: "accepted",
    });

    const deliveryId = String(delivery.id);
    const rows = await owner`
      SELECT a.whatsapp_message_id, a.message_id, a.email_message_id,
             m.status::text, m.template_name, m.template_language, d.message_id AS dispatch_id
      FROM message_delivery_attempts a
      JOIN whatsapp_messages m ON m.id = a.whatsapp_message_id
      JOIN whatsapp_dispatches d ON d.message_id = m.id
      WHERE a.tenant_id = ${tenantId} AND a.delivery_id = ${deliveryId}`;
    expect(rows[0]).toMatchObject({
      whatsapp_message_id: deliveryId,
      // The XOR: the other two arms must be NULL, not merely unread.
      message_id: null,
      email_message_id: null,
      status: "queued",
      template_name: "order_shipped",
      template_language: "en_US",
      dispatch_id: deliveryId,
    });
    expect(await counts()).toMatchObject({
      whatsappMessages: 1,
      whatsappDispatches: 1,
      deliveries: 1,
      attempts: 1,
      // The regression that matters: an unhandled channel used to fall through to SMS.
      smsMessages: 0,
    });
  });

  it("stores the binding in the shape the dispatch worker reads", async () => {
    const response = await send(
      { ...payload, to: "+233200000043" },
      "wa-accept-content",
    );
    expect(response.statusCode).toBe(202);
    const deliveryId = (jsonBody(response) as { delivery: { id: string } })
      .delivery.id;
    await expect(storedContent(deliveryId)).resolves.toEqual({
      to: "+233200000043",
      template_name: "order_shipped",
      template_language: "en_US",
      template_category: "utility",
      variables: ["Ada", "2"],
      currency: "GHS",
    });
  });

  it("replays the same request without a second message or charge", async () => {
    const before = await counts();
    const first = await send(payload, "wa-accept-001");
    const second = await send(payload, "wa-accept-001");
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect((jsonBody(second) as { delivery: { id: string } }).delivery.id).toBe(
      (jsonBody(first) as { delivery: { id: string } }).delivery.id,
    );
    expect(await counts()).toEqual(before);
  });

  it("409s on an idempotency conflict without persisting anything", async () => {
    const before = await counts();
    const response = await send(
      { ...payload, data: { name: "Grace", count: 3 } },
      "wa-accept-001",
    );
    expect(response.statusCode).toBe(409);
    expect(jsonBody(response)).toMatchObject({
      error: { code: "idempotency_conflict" },
    });
    expect(await counts()).toEqual(before);
  });

  it("rejects an email-shaped recipient for a WhatsApp definition", async () => {
    const before = await counts();
    const res = await send(
      { ...payload, to: "ada@example.test" },
      "wa-recipient-mismatch",
    );
    expect(res.statusCode).toBe(400);
    const { error } = jsonBody(res) as {
      error: { code: string; message: string };
    };
    expect(error).toMatchObject({ code: "recipient_channel_mismatch" });
    expect(error.message).not.toContain("ada@example.test");
    expect(await counts()).toEqual(before);
  });

  it("blocks a parameter Meta would reject before anything is persisted", async () => {
    const before = await counts();
    const response = await send(
      { ...payload, data: { name: "Ada\nBaker", count: 2 } },
      "wa-bad-parameter",
    );
    expect(response.statusCode).toBe(400);
    const body = jsonBody(response) as {
      error: { code: string; message: string };
    };
    // Meta rejects newline/tab/5+-space parameters. Catching it here turns a post-reserve provider
    // failure into a pre-acceptance 400 — and the rejected value never appears in the message.
    expect(body.error.code).toBe("parameter_whitespace");
    expect(body.error.message).not.toContain("Baker");
    expect(await counts()).toEqual(before);
  });

  it("classifies a marketing template as promotional traffic", async () => {
    const response = await preview({
      ...previewPayload,
      key: "order.whatsapp.marketing",
    });
    expect(response.statusCode).toBe(201);
    expect(jsonBody(response)).toMatchObject({
      channel: "whatsapp",
      message_class: "promotional",
    });
  });
});
