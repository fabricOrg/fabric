import { createAppDb } from "@app/db";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
if (!SUPER_URL || !APP_URL) {
  throw new Error(
    "whatsapp message isolation gate requires DATABASE_URL_SUPER + DATABASE_URL_APP (fresh isolated DB)",
  );
}

const owner = postgres(SUPER_URL, { max: 2 });
const db = createAppDb(APP_URL, { max: 1 });

const TENANT_A = "a1000000-0000-4000-8000-0000000000aa";
const TENANT_B = "b1000000-0000-4000-8000-0000000000bb";

let appA = "";
let envA = "";
let subjectA = "";

function first<T>(rows: readonly T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("expected at least one row, got none");
  return row;
}

async function seedTenant(id: string, slug: string) {
  await owner.unsafe(
    "INSERT INTO accounts (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
    [id, `Tenant ${slug}`, slug],
  );
}

async function cleanup() {
  await owner.unsafe(
    "DELETE FROM whatsapp_messages WHERE tenant_id IN ($1, $2)",
    [TENANT_A, TENANT_B],
  );
  await owner.unsafe("DELETE FROM data_subjects WHERE tenant_id IN ($1, $2)", [
    TENANT_A,
    TENANT_B,
  ]);
  await owner.unsafe("DELETE FROM accounts WHERE id IN ($1, $2)", [
    TENANT_A,
    TENANT_B,
  ]);
}

describe("WhatsApp messages tenant isolation", () => {
  beforeAll(async () => {
    await cleanup();
    await seedTenant(TENANT_A, "whatsapp-a");
    await seedTenant(TENANT_B, "whatsapp-b");

    await db.withTenant(TENANT_A, async (tx) => {
      appA = first(
        await tx<{ id: string }[]>`
          INSERT INTO applications (tenant_id, name, slug)
          VALUES (${TENANT_A}, 'Default', 'default') RETURNING id`,
      ).id;
      envA = first(
        await tx<{ id: string }[]>`
          INSERT INTO environments (tenant_id, application_id, type, status)
          VALUES (${TENANT_A}, ${appA}, 'sandbox', 'active') RETURNING id`,
      ).id;
      subjectA = first(
        await tx<{ subject_id: string }[]>`
          INSERT INTO data_subjects (tenant_id) VALUES (${TENANT_A}) RETURNING subject_id`,
      ).subject_id;
      await tx`
        INSERT INTO whatsapp_messages
          (tenant_id, application_id, environment_id, subject_id, template_category)
        VALUES (${TENANT_A}, ${appA}, ${envA}, ${subjectA}, 'utility')`;
    });
  });

  afterAll(async () => {
    await cleanup();
    await db.end();
    await owner.end();
  });

  it("hides tenant A rows inside tenant B context", async () => {
    const seen = await db.withTenant(TENANT_B, async (tx) => {
      const rows = await tx<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM whatsapp_messages`;
      return first(rows).n;
    });

    expect(seen).toBe(0);
  });

  it("rejects unsupported template categories", async () => {
    await expect(
      db.withTenant(TENANT_A, async (tx) => {
        await tx`
          INSERT INTO whatsapp_messages
            (tenant_id, application_id, environment_id, subject_id, template_category)
          VALUES (${TENANT_A}, ${appA}, ${envA}, ${subjectA}, 'promotional')`;
      }),
    ).rejects.toThrow();
  });
});
