import { createAppDb } from "@app/db";
import { HttpException } from "@nestjs/common";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SmsTemplatesService } from "./sms-templates.service.js";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
if (!SUPER_URL || !APP_URL) {
  throw new Error(
    "sms templates integration needs DATABASE_URL_SUPER + DATABASE_URL_APP",
  );
}

const TENANT_A = "abcdabcd-1111-4111-8111-000000005601";
const TENANT_B = "abcdabcd-2222-4222-8222-000000005601";
const owner = postgres(SUPER_URL, { max: 1 });
const db = createAppDb(APP_URL, { max: 2 });
const service = new SmsTemplatesService(db);

beforeAll(async () => {
  await owner.unsafe(
    `INSERT INTO accounts (id, name, slug, plan)
     VALUES ($1, 'Templates A', 'templates-a-5601', 'sandbox'),
            ($2, 'Templates B', 'templates-b-5601', 'sandbox')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B],
  );
});

afterAll(async () => {
  await owner.unsafe("DELETE FROM sms_templates WHERE tenant_id IN ($1, $2)", [
    TENANT_A,
    TENANT_B,
  ]);
  await owner.unsafe("DELETE FROM accounts WHERE id IN ($1, $2)", [
    TENANT_A,
    TENANT_B,
  ]);
  await db.end();
  await owner.end();
});

describe("SMS templates persistence and RLS", () => {
  it("creates, updates, lists, and deletes within one tenant", async () => {
    const created = await service.create(TENANT_A, {
      name: "Receipt",
      body: "Hi {{name}}, payment received.",
      class: "transactional",
    });
    expect((await service.list(TENANT_A)).map((item) => item.id)).toContain(
      created.id,
    );

    const updated = await service.update(TENANT_A, created.id, {
      name: "Payment receipt",
    });
    expect(updated.name).toBe("Payment receipt");

    await service.remove(TENANT_A, created.id);
    expect(await service.list(TENANT_A)).toEqual([]);
  });

  it("does not expose or mutate another tenant's template", async () => {
    const created = await service.create(TENANT_A, {
      name: "Private template",
      body: "Tenant A only.",
      class: "transactional",
    });
    expect(await service.list(TENANT_B)).toEqual([]);
    await expect(
      service.update(TENANT_B, created.id, { body: "Cross-tenant edit" }),
    ).rejects.toSatisfy(
      (error) => error instanceof HttpException && error.getStatus() === 404,
    );
  });
});
