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
import { MessageDefinitionsService } from "../message-definitions/message-definitions.service.js";
import { MessagePreviewService } from "./message-preview.service.js";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
const describeDb = SUPER_URL && APP_URL ? describe : describe.skip;

const owner = postgres(SUPER_URL ?? "", { max: 2 });
const db = createAppDb(APP_URL ?? "", { max: 1 });
const apps = new ApplicationsService(db);
const audit = { record: async () => undefined } as unknown as AuditService;
const defs = new MessageDefinitionsService(db, audit);
const preview = new MessagePreviewService(db);

const TENANT = randomUUID();
let sandboxEnvId = "";

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
    sandboxEnvId = app.environments.find((e) => e.type === "sandbox")?.id ?? "";
    // Create + publish a definition to sandbox so preview has a released version to resolve.
    const created = await defs.create(TENANT, {
      key: "order.shipped",
      variable_schema: schema,
      content: { body: "Hi {{name}}, {{count}} orders." },
      default_locale: "en",
    });
    await defs.publish(
      TENANT,
      created.definition.id,
      { environment: "sandbox", version_id: created.latest_version?.id ?? "" },
      "key_test",
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
      },
      sandboxEnvId,
    );
    expect(out.blockers).toEqual([]);
    expect(out.environment).toBe("sandbox");
    expect(out.resolved_locale).toBe("en");
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
    expect(await sideEffectCounts()).toEqual(before);
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
