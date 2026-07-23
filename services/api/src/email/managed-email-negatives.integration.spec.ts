import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { VariableSchema } from "@app/contracts";
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
} from "../messages/managed-messages.spec-harness.js";

const superUrl = process.env.DATABASE_URL_SUPER;
const appUrl = process.env.DATABASE_URL_APP;
const describeDb = superUrl && appUrl ? describe : describe.skip;
process.env.REDIS_QUEUE_URL = "";
process.env.MAINTENANCE_CRON_ENABLED = "false";
process.env.TENANT_TOKEN_SECRET ??= "integration-test-tenant-token-secret";

const schema: VariableSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    count: { type: "integer", minimum: 0 },
  },
  required: ["name"],
};

describeDb("SDK-007 managed email send negatives", () => {
  const owner = postgres(superUrl ?? "", { max: 2 });
  const db = createAppDb(appUrl ?? "");
  const tenantId = randomUUID();
  const rawKey = `sk_test_${randomUUID().replace(/-/g, "")}${"0".repeat(8)}`;
  let applicationId = "";
  let environmentId = "";
  let app: NestFastifyApplication;

  function send(
    key: string,
    data: Record<string, unknown>,
    idempotency: string,
  ) {
    return app.inject({
      method: "POST",
      url: "/v1/message-deliveries",
      headers: {
        authorization: `Bearer ${rawKey}`,
        "content-type": "application/json",
        "idempotency-key": idempotency,
      },
      payload: {
        key,
        to: "negative@example.test",
        data,
        currency: "GHS",
      },
    });
  }

  async function sideEffects() {
    return db.withTenant(tenantId, async (tx) => {
      const q = async (table: string) => {
        const rows = await tx.unsafe(`SELECT count(*)::int AS n FROM ${table}`);
        return Number(rows[0]?.n ?? 0);
      };
      const balances = await tx`
        SELECT kind, balance_minor FROM ledger_accounts ORDER BY kind`;
      return {
        deliveries: await q("message_deliveries"),
        attempts: await q("message_delivery_attempts"),
        emailMessages: await q("email_messages"),
        emailDispatches: await q("email_dispatches"),
        outbox: await q("outbox_events"),
        ledgerTransactions: await q("ledger_transactions"),
        wallet: balances.map((row) => ({
          kind: String(row.kind),
          balance: String(row.balance_minor),
        })),
      };
    });
  }

  async function seedEmail(input: {
    key: string;
    subject: string;
    text?: string;
    html?: string;
  }) {
    const definitionId = randomUUID();
    const versionId = randomUUID();
    await owner`
      INSERT INTO message_definitions (id, tenant_id, application_id, key, status)
      VALUES (${definitionId}, ${tenantId}, ${applicationId}, ${input.key}, 'active')`;
    await owner`
      INSERT INTO message_definition_versions (
        id, tenant_id, definition_id, application_id, version, channel,
        variable_schema, content, default_locale
      ) VALUES (
        ${versionId}, ${tenantId}, ${definitionId}, ${applicationId},
        1, 'email', ${owner.json(schema)}::jsonb,
        ${owner.json({
          subject: input.subject,
          ...(input.text ? { text: input.text } : {}),
          ...(input.html ? { html: input.html } : {}),
          locales: {},
        })}::jsonb,
        'en'
      )`;
    await owner`
      INSERT INTO message_definition_releases (
        tenant_id, application_id, environment_id, definition_id, version_id
      ) VALUES (
        ${tenantId}, ${applicationId}, ${environmentId},
        ${definitionId}, ${versionId}
      )`;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL_APP = appUrl;
    const seeded = await seedManagedTenant({
      owner,
      db,
      tenantId,
      rawKey,
      scopes: ["messages:send", "messages:read"],
    });
    applicationId = seeded.applicationId;
    environmentId = seeded.environmentId;
    await seedEmail({
      key: "order.email.oversized",
      subject: "Order {{name}}",
      text: "x".repeat(262_145),
    });
    await seedEmail({
      key: "order.email.subject",
      subject: "Order {{name}}",
      text: "Header guard",
    });
    await seedEmail({
      key: "order.email.schema",
      subject: "Order {{name}}",
      text: "Hi {{name}}, {{count}} orders",
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
    await cleanManagedTenant(owner, tenantId);
    await Promise.all([owner.end(), db.end()]);
  });

  it("rejects an oversized rendered payload without side effects", async () => {
    const before = await sideEffects();
    const response = await send(
      "order.email.oversized",
      { name: "Ada", count: 2 },
      "email-too-large",
    );

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "email_payload_too_large" },
    });
    expect(await sideEffects()).toEqual(before);
  });

  it("rejects a subject newline without echoing recipient or value", async () => {
    const before = await sideEffects();
    const response = await send(
      "order.email.subject",
      { name: "Ada\r\nBcc: victim@example.test", count: 2 },
      "email-subject-newline",
    );

    expect(response.statusCode).toBe(400);
    const body = response.json() as {
      error: { code: string; message: string; param?: string };
    };
    expect(body.error).toMatchObject({
      code: "subject_newline",
      param: "subject",
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("negative@example.test");
    expect(serialized).not.toContain("victim@example.test");
    expect(serialized).not.toContain("Bcc:");
    expect(await sideEffects()).toEqual(before);
  });

  it("rejects an invalid variable payload without side effects", async () => {
    const before = await sideEffects();
    const response = await send(
      "order.email.schema",
      { count: "two" },
      "email-invalid-vars",
    );

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; param?: string } };
    expect(body.error.code).toBe("missing_required");
    expect(body.error.param).toBe("name");
    expect(await sideEffects()).toEqual(before);
  });
});
