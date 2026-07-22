// ============================================================================================
// SDK-003 slice 5 — MessagePreviewService against a real migrated DB. Proves: preview resolves the
// RELEASED definition for the environment and renders it through the shared core; a valid preview
// returns body/encoding/segments/exact cost; an invalid payload returns path-coded blockers and no
// preview; an unreleased key 404s; and — the load-bearing guarantee — a preview writes NOTHING
// (messages, dispatches, outbox, PII vault all unchanged). tier: test:integration.
// ============================================================================================

import { randomUUID } from "node:crypto";
import type { VariableSchema } from "@app/contracts";
import { createAppDb } from "@app/db";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApplicationsService } from "../applications/applications.service.js";
import type { AuditService } from "../audit/audit.service.js";
import type { ConsentService } from "../consent/consent.service.js";
import { MessageDefinitionsService } from "../message-definitions/message-definitions.service.js";
import type { SendersService } from "../senders/senders.service.js";
import { MessagePreviewService } from "./message-preview.service.js";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
const describeDb = SUPER_URL && APP_URL ? describe : describe.skip;

const owner = postgres(SUPER_URL ?? "", { max: 2 });
const db = createAppDb(APP_URL ?? "", { max: 1 });
const apps = new ApplicationsService(db);
const audit = { record: async () => undefined } as unknown as AuditService;
const defs = new MessageDefinitionsService(db, audit);
const senders = {
  senderStatus: async () => "active" as const,
} as unknown as SendersService;
const consent = {
  isSuppressed: async () => false,
} as unknown as ConsentService;
const preview = new MessagePreviewService(db, senders, consent);

const TENANT = randomUUID();
let sandboxEnvId = "";
let appId = "";

const schema: VariableSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    count: { type: "integer", minimum: 0 },
  },
  required: ["name"],
};

async function sideEffectCounts() {
  const q = async (table: string) => {
    const rows = await owner.unsafe(
      `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
      [TENANT],
    );
    return (rows[0] as unknown as { n: number }).n;
  };
  return {
    messages: await q("messages"),
    dispatches: await q("message_dispatches"),
    outbox: await q("outbox_events"),
    pii: await q("pii_vault"),
  };
}

describeDb("SDK-003 MessagePreviewService (no side effects)", () => {
  beforeAll(async () => {
    await owner.unsafe(
      "INSERT INTO accounts (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
      [TENANT, "Preview", `prev-${TENANT.slice(0, 8)}`],
    );
    const app = await apps.create(TENANT, { name: "Default", slug: "default" });
    appId = app.id;
    sandboxEnvId = app.environments.find((e) => e.type === "sandbox")?.id ?? "";
    // Create + publish a definition to sandbox so preview has a released version to resolve.
    const created = await defs.create(TENANT, {
      channel: "sms",
      key: "order.shipped",
      variable_schema: schema,
      content: {
        body: "Hi {{name}}, {{count}} orders.",
        class: "transactional",
        locales: { fr: { body: "Bonjour {{name}}, {{count}} commandes." } },
      },
      default_locale: "en",
      sender_id: "FABRIC",
    });
    await defs.publish(
      TENANT,
      created.definition.id,
      { environment: "sandbox", version_id: created.latest_version?.id ?? "" },
      "key_test",
    );

    // Email authoring isn't wired through the API yet (SDK-007 slice 4). Seed an EMAIL release directly
    // (raw, as the owner) so preview's email branch has something to resolve — and note it has NO sender
    // binding, which exercises the LEFT join.
    const emailDefId = randomUUID();
    const emailVerId = randomUUID();
    await owner.unsafe(
      `INSERT INTO message_definitions (id, tenant_id, application_id, key, status)
       VALUES ($1, $2, $3, 'order.email', 'active')`,
      [emailDefId, TENANT, appId],
    );
    await owner.unsafe(
      `INSERT INTO message_definition_versions
         (id, tenant_id, definition_id, application_id, version, channel, variable_schema, content, default_locale)
       VALUES ($1, $2, $3, $4, 1, 'email', $5::jsonb, $6::jsonb, 'en')`,
      [
        emailVerId,
        TENANT,
        emailDefId,
        appId,
        JSON.stringify(schema),
        JSON.stringify({
          subject: "Order {{name}}",
          text: "Hi {{name}}, {{count}} orders",
          html: "<p>Hi {{name}}</p>",
        }),
      ],
    );
    await owner.unsafe(
      `INSERT INTO message_definition_releases
         (tenant_id, application_id, environment_id, definition_id, version_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [TENANT, appId, sandboxEnvId, emailDefId, emailVerId],
    );
  });
  afterAll(async () => {
    await owner.unsafe("DELETE FROM accounts WHERE id = $1", [TENANT]);
    await db.end();
    await owner.end();
  });

  it("renders a released definition with exact segments and cost", async () => {
    const before = await sideEffectCounts();
    const out = await preview.preview(
      TENANT,
      {
        key: "order.shipped",
        data: { name: "Ada", count: 2 },
        currency: "GHS",
        to: "+233201234567",
      },
      sandboxEnvId,
    );
    expect(out.blockers).toEqual([]);
    expect(out.environment).toBe("sandbox");
    expect(out.resolved_locale).toBe("en");
    expect(out).toMatchObject({
      eligible: true,
      warnings: [],
      sender: { sender_id: "FABRIC", status: "sandbox" },
      message_class: "transactional",
    });
    expect(out.preview?.body).toBe("Hi Ada, 2 orders.");
    expect(out.preview?.segments).toBe(1);
    expect(out.preview?.cost_minor).toBe("3");
    // Nothing was written.
    expect(await sideEffectCounts()).toEqual(before);
  });

  it("returns path-coded blockers and no preview for an invalid payload — still no writes", async () => {
    const before = await sideEffectCounts();
    const out = await preview.preview(
      TENANT,
      { key: "order.shipped", data: { count: 2 }, currency: "GHS" },
      sandboxEnvId,
    );
    expect(out.preview).toBeNull();
    expect(out.blockers).toContainEqual({
      path: "name",
      code: "missing_required",
    });
    expect(out.warnings).toContainEqual({
      path: "to",
      code: "recipient_not_provided",
    });
    expect(await sideEffectCounts()).toEqual(before);
  });

  it("resolves a released locale and blocks an unsupported locale without writes", async () => {
    const before = await sideEffectCounts();
    const localized = await preview.preview(
      TENANT,
      {
        key: "order.shipped",
        data: { name: "Ada", count: 2 },
        locale: "fr",
      },
      sandboxEnvId,
    );
    expect(localized.resolved_locale).toBe("fr");
    expect(localized.preview?.body).toBe("Bonjour Ada, 2 commandes.");

    const unsupported = await preview.preview(
      TENANT,
      { key: "order.shipped", data: { name: "Ada" }, locale: "es" },
      sandboxEnvId,
    );
    expect(unsupported.preview).toBeNull();
    expect(unsupported.blockers).toContainEqual({
      path: "locale",
      code: "locale_not_supported",
    });
    expect(await sideEffectCounts()).toEqual(before);
  });

  it("renders a released EMAIL definition — subject/text/html, size tier, exact price; no writes", async () => {
    const before = await sideEffectCounts();
    const out = await preview.preview(
      TENANT,
      { key: "order.email", data: { name: "Ada", count: 2 }, currency: "GHS" },
      sandboxEnvId,
    );
    expect(out.channel).toBe("email");
    expect(out.blockers).toEqual([]);
    expect(out.eligible).toBe(true);
    // Email has no SMS sender/compliance in this slice; domain binding is deferred.
    expect(out.sender).toEqual({ sender_id: "", status: "not_evaluated" });
    expect(out.preview).toBeNull();
    expect(out.email_preview).toMatchObject({
      subject: "Order Ada",
      text: "Hi Ada, 2 orders",
      html: "<p>Hi Ada</p>",
      tier: "standard",
      cost_minor: "5",
      currency: "GHS",
    });
    expect(await sideEffectCounts()).toEqual(before);
  });

  it("HTML-escapes an email variable value end-to-end", async () => {
    const out = await preview.preview(
      TENANT,
      {
        key: "order.email",
        data: { name: "<b>x</b>", count: 1 },
        currency: "GHS",
      },
      sandboxEnvId,
    );
    expect(out.email_preview?.html).toBe("<p>Hi &lt;b&gt;x&lt;/b&gt;</p>");
    // The plain-text part is NOT escaped.
    expect(out.email_preview?.text).toBe("Hi <b>x</b>, 1 orders");
  });

  it("404s for an SMS release missing its sender binding (LEFT-join must not preview an empty sender)", async () => {
    // Seed a released SMS definition with NO sender binding — a misconfiguration the SDK-003 publish
    // invariant normally prevents. The LEFT join would otherwise return a row with a null sender; the
    // service must still 404 rather than preview with an empty sender.
    const defId = randomUUID();
    const verId = randomUUID();
    await owner.unsafe(
      `INSERT INTO message_definitions (id, tenant_id, application_id, key, status)
       VALUES ($1, $2, $3, 'order.nobinding', 'active')`,
      [defId, TENANT, appId],
    );
    await owner.unsafe(
      `INSERT INTO message_definition_versions
         (id, tenant_id, definition_id, application_id, version, channel, variable_schema, content, default_locale)
       VALUES ($1, $2, $3, $4, 1, 'sms', $5::jsonb, $6::jsonb, 'en')`,
      [
        verId,
        TENANT,
        defId,
        appId,
        JSON.stringify(schema),
        JSON.stringify({
          body: "Hi {{name}}",
          class: "transactional",
          locales: {},
        }),
      ],
    );
    await owner.unsafe(
      `INSERT INTO message_definition_releases
         (tenant_id, application_id, environment_id, definition_id, version_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [TENANT, appId, sandboxEnvId, defId, verId],
    );
    await expect(
      preview.preview(
        TENANT,
        { key: "order.nobinding", data: { name: "Ada" } },
        sandboxEnvId,
      ),
    ).rejects.toMatchObject({
      status: 404,
      response: { error: { code: "definition_not_released" } },
    });
  });

  it("404s for a key with no release in the environment", async () => {
    await expect(
      preview.preview(TENANT, { key: "order.unknown" }, sandboxEnvId),
    ).rejects.toMatchObject({
      status: 404,
      response: { error: { code: "definition_not_released" } },
    });
  });
});
