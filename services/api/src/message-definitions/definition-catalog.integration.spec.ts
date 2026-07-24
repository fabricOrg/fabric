import { randomUUID } from "node:crypto";
import { createAppDb } from "@app/db";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApplicationsService } from "../applications/applications.service.js";
import type { AuditService } from "../audit/audit.service.js";
import { DefinitionCatalogService } from "./definition-catalog.service.js";
import { MessageDefinitionsService } from "./message-definitions.service.js";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
const describeDb = SUPER_URL && APP_URL ? describe : describe.skip;
const owner = postgres(SUPER_URL ?? "", { max: 2 });
const db = createAppDb(APP_URL ?? "", { max: 1 });
const apps = new ApplicationsService(db);
const audit = { record: async () => undefined } as unknown as AuditService;
const definitions = new MessageDefinitionsService(db, audit);
const catalog = new DefinitionCatalogService(db);
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();

async function seedTenant(id: string) {
  await owner.unsafe(
    "INSERT INTO accounts (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
    [id, `Catalog ${id.slice(0, 8)}`, `catalog-${id.slice(0, 8)}`],
  );
}

describeDb("definition catalog (real RLS)", () => {
  beforeAll(async () => {
    await seedTenant(TENANT_A);
    await seedTenant(TENANT_B);
  });

  afterAll(async () => {
    if (SUPER_URL) {
      await owner.unsafe("DELETE FROM accounts WHERE id IN ($1, $2)", [
        TENANT_A,
        TENANT_B,
      ]);
    }
    await Promise.all([owner.end(), db.end()]);
  });

  it("is deterministic, sorted, content-free, and application contained", async () => {
    const app = await apps.create(TENANT_A, {
      name: "Checkout",
      slug: "checkout",
    });
    const other = await apps.create(TENANT_A, {
      name: "Support",
      slug: "support",
    });
    for (const key of ["order.shipped", "account.created"].reverse()) {
      const state = await definitions.create(TENANT_A, {
        application_id: app.id,
        channel: "sms",
        key,
        variable_schema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
        content: {
          body: "Hello {{name}}",
          class: "transactional",
          locales: { fr: { body: "Bonjour {{name}}" } },
        },
        default_locale: "en",
        sender_id: "FABRIC",
      });
      await definitions.publish(
        TENANT_A,
        state.definition.id,
        {
          environment: "sandbox",
          version_id: state.latest_version?.id ?? "",
        },
        "test",
      );
    }
    const sandbox = app.environments.find((item) => item.type === "sandbox");
    const input = {
      tenantId: TENANT_A,
      applicationId: app.id,
      environmentId: sandbox?.id ?? "",
    };
    const first = await catalog.read(input);
    const second = await catalog.read(input);
    expect(first).toEqual(second);
    expect(first.definitions.map((item) => item.key)).toEqual([
      "account.created",
      "order.shipped",
    ]);
    expect(first.definitions[0]?.locales).toEqual(["en", "fr"]);
    expect(JSON.stringify(first)).not.toMatch(/Hello|Bonjour|FABRIC/);

    const otherSandbox = other.environments.find(
      (item) => item.type === "sandbox",
    );
    const isolated = await catalog.read({
      tenantId: TENANT_A,
      applicationId: other.id,
      environmentId: otherSandbox?.id ?? "",
    });
    expect(isolated.definitions).toEqual([]);
  });

  it("RLS rejects another tenant's environment identity", async () => {
    const other = await apps.create(TENANT_B, {
      name: "Other",
      slug: "other",
    });
    const sandbox = other.environments.find((item) => item.type === "sandbox");
    await expect(
      catalog.read({
        tenantId: TENANT_A,
        applicationId: other.id,
        environmentId: sandbox?.id ?? "",
      }),
    ).rejects.toMatchObject({
      status: 404,
      response: { error: { code: "catalog_environment_not_found" } },
    });
  });
});
