// ============================================================================================
// SDK-007 slice 4c — Email authoring through managed message definitions against a real migrated
// DB (RLS-enforced). Proves channel persistence, sender-binding absence, channel immutability,
// compatible email versioning, publish, and response shape. tier: test:integration.
// ============================================================================================

import { randomUUID } from "node:crypto";
import type { VariableSchema } from "@app/contracts";
import { createAppDb, messageDefinitionVersions } from "@app/db";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApplicationsService } from "../applications/applications.service.js";
import type { AuditService } from "../audit/audit.service.js";
import { MessageDefinitionsService } from "./message-definitions.service.js";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
const describeDb = SUPER_URL && APP_URL ? describe : describe.skip;

const owner = postgres(SUPER_URL ?? "", { max: 2 });
const db = createAppDb(APP_URL ?? "", { max: 1 });
const apps = new ApplicationsService(db);
const audit = { record: async () => undefined } as unknown as AuditService;
const svc = new MessageDefinitionsService(db, audit);
const TENANT = randomUUID();

const schemaV1: VariableSchema = {
  type: "object",
  properties: { name: { type: "string" } },
  required: ["name"],
};

async function seedTenant(id: string) {
  await owner.unsafe(
    "INSERT INTO accounts (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
    [id, `Email Def ${id.slice(0, 8)}`, `email-def-${id.slice(0, 8)}`],
  );
}

async function versionChannels(definitionId: string) {
  return db.withTenantDrizzle(TENANT, async (tx) =>
    tx
      .select({ channel: messageDefinitionVersions.channel })
      .from(messageDefinitionVersions)
      .where(eq(messageDefinitionVersions.definitionId, definitionId)),
  );
}

async function createSmsDefinition(key: string) {
  return svc.create(TENANT, {
    channel: "sms",
    key,
    variable_schema: schemaV1,
    content: { body: "Hi {{name}}", class: "transactional", locales: {} },
    default_locale: "en",
    sender_id: "FABRIC",
  });
}

describeDb("SDK-007 email message definition authoring (real RLS)", () => {
  beforeAll(async () => {
    await seedTenant(TENANT);
    await apps.create(TENANT, { name: "Default", slug: "default" });
  });

  afterAll(async () => {
    await owner.unsafe("DELETE FROM accounts WHERE id = $1", [TENANT]);
    await db.end();
    await owner.end();
  });

  it("creates email definitions without binding an SMS sender", async () => {
    const state = await svc.create(TENANT, {
      channel: "email",
      key: "email.created",
      variable_schema: schemaV1,
      content: {
        from: "no-reply@example.com",
        subject: "Hi {{name}}",
        text: "Hello {{name}}",
        locales: { fr: { subject: "Bonjour {{name}}", text: "Salut" } },
      },
      default_locale: "en",
    });

    expect(state.latest_version?.channel).toBe("email");
    expect(state.latest_version?.content).toMatchObject({
      subject: "Hi {{name}}",
    });
    expect(state.sender_bindings).toEqual([]);
    await expect(versionChannels(state.definition.id)).resolves.toEqual([
      { channel: "email" },
    ]);
  });

  it("keeps a definition channel immutable across versions", async () => {
    const email = await svc.create(TENANT, {
      channel: "email",
      key: "email.immutable",
      variable_schema: schemaV1,
      content: { subject: "Hi", text: "Hello {{name}}", locales: {} },
      default_locale: "en",
    });
    await expect(
      svc.addVersion(TENANT, email.definition.id, {
        channel: "sms",
        variable_schema: schemaV1,
        content: { body: "Hi {{name}}", class: "transactional", locales: {} },
        default_locale: "en",
        sender_id: "FABRIC",
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: { error: { code: "channel_immutable" } },
    });
    await expect(versionChannels(email.definition.id)).resolves.toHaveLength(1);

    const sms = await createSmsDefinition("sms.immutable");
    await expect(
      svc.addVersion(TENANT, sms.definition.id, {
        channel: "email",
        variable_schema: schemaV1,
        content: { subject: "Hi", text: "Hello {{name}}", locales: {} },
        default_locale: "en",
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: { error: { code: "channel_immutable" } },
    });
    await expect(versionChannels(sms.definition.id)).resolves.toHaveLength(1);
  });

  it("adds and publishes a compatible email version", async () => {
    const created = await svc.create(TENANT, {
      channel: "email",
      key: "email.publish",
      variable_schema: schemaV1,
      content: {
        subject: "Hi {{name}}",
        text: "Hello {{name}}",
        locales: { fr: { subject: "Bonjour {{name}}" } },
      },
      default_locale: "en",
    });
    const added = await svc.addVersion(TENANT, created.definition.id, {
      channel: "email",
      variable_schema: {
        type: "object",
        properties: { name: { type: "string" }, note: { type: "string" } },
        required: ["name"],
      },
      content: {
        subject: "Updated {{name}}",
        html: "<p>Hello {{name}}</p>",
        locales: { fr: { subject: "Bonjour {{name}}" } },
      },
      default_locale: "en",
    });
    expect(added.latest_version).toMatchObject({
      version: 2,
      channel: "email",
    });

    const published = await svc.publish(
      TENANT,
      created.definition.id,
      { environment: "sandbox", version_id: added.latest_version?.id ?? "" },
      "key_test",
    );
    expect(published.definition.status).toBe("active");
    expect(published.releases[0]?.version_id).toBe(added.latest_version?.id);

    const listed = await svc.list(TENANT);
    const email = listed.definitions.find(
      (item) => item.definition.id === created.definition.id,
    );
    expect(email?.latest_version?.channel).toBe("email");
    expect(email?.latest_version?.content).toMatchObject({
      subject: "Updated {{name}}",
    });
  });
});
