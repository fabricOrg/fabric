// ============================================================================================
// MANAGED MESSAGE DEFINITIONS isolation + invariant gate (SDK-003 slice 1). tier: test:integration.
// Asserts the database enforces, through the real RLS-constrained runtime role, every invariant the
// architecture plan mandates for definitions/versions/releases/sender bindings:
//   - tenant isolation (read + WITH CHECK write) and fail-closed on unset context;
//   - stable key unique per application, CASE-INSENSITIVELY;
//   - published version immutability (runtime role has no UPDATE/DELETE grant);
//   - one active release per (environment, definition);
//   - a release cannot cross application/definition (composite containment FKs).
// Needs a migrated DB (0075 DDL + 0076 RLS) + DATABASE_URL_SUPER + DATABASE_URL_APP.
// ============================================================================================

import { randomUUID } from "node:crypto";
import { createAppDb } from "@app/db";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
if (!SUPER_URL || !APP_URL) {
  throw new Error(
    "message-definitions gate requires DATABASE_URL_SUPER + DATABASE_URL_APP (fresh isolated DB)",
  );
}

// owner = superuser (bypasses FORCE RLS) for cross-tenant seeds/assertions; db is the RLS-enforced seam.
const owner = postgres(SUPER_URL, { max: 2 });
const db = createAppDb(APP_URL, { max: 1 });

const TENANT_A = "a0000000-0000-4000-8000-0000000000aa";
const TENANT_B = "b0000000-0000-4000-8000-0000000000bb";

// Seeded ids (application, environment, definition, version) for tenant A, filled in beforeAll.
let appA = "";
let envA = "";
let appA2 = "";
let envA2 = "";
let defA = "";
let verA1 = "";

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
  // Managed deliveries/attempts reference tenant_id with ON DELETE RESTRICT, so the channel-CHECK
  // fixtures below must be cleared before the account delete (attempts before deliveries — the
  // attempt->delivery containment FK is also RESTRICT).
  await owner.unsafe(
    "DELETE FROM message_delivery_attempts WHERE tenant_id IN ($1, $2)",
    [TENANT_A, TENANT_B],
  );
  await owner.unsafe(
    "DELETE FROM message_deliveries WHERE tenant_id IN ($1, $2)",
    [TENANT_A, TENANT_B],
  );
  // The email-channel fixture seeds an email_messages row (+ its data_subjects parent) that the attempt
  // references (RESTRICT). Clear them after the attempts, before the account delete.
  await owner.unsafe("DELETE FROM email_messages WHERE tenant_id IN ($1, $2)", [
    TENANT_A,
    TENANT_B,
  ]);
  await owner.unsafe("DELETE FROM data_subjects WHERE tenant_id IN ($1, $2)", [
    TENANT_A,
    TENANT_B,
  ]);
  // Delete ONLY our two tenants; accounts -> applications -> environments -> definitions ->
  // versions/releases all cascade on tenant delete. Never blanket-delete shared tables — other local
  // fixtures (e.g. email messages) hold FKs to environments/accounts and would block teardown.
  await owner.unsafe("DELETE FROM accounts WHERE id IN ($1, $2)", [
    TENANT_A,
    TENANT_B,
  ]);
}

describe("SDK-003 — message definition isolation + invariants", () => {
  beforeAll(async () => {
    await cleanup();
    await seedTenant(TENANT_A, "def-tenant-a");
    await seedTenant(TENANT_B, "def-tenant-b");

    // Tenant A: two applications, each with a sandbox environment; a definition + one released
    // version live in the first application. All writes go through the RLS runtime seam.
    await db.withTenant(TENANT_A, async (tx) => {
      const a1 = await tx<{ id: string }[]>`
        INSERT INTO applications (tenant_id, name, slug)
        VALUES (${TENANT_A}, 'Default', 'default') RETURNING id`;
      appA = first(a1).id;
      const e1 = await tx<{ id: string }[]>`
        INSERT INTO environments (tenant_id, application_id, type, status)
        VALUES (${TENANT_A}, ${appA}, 'sandbox', 'active') RETURNING id`;
      envA = first(e1).id;

      const a2 = await tx<{ id: string }[]>`
        INSERT INTO applications (tenant_id, name, slug)
        VALUES (${TENANT_A}, 'Second', 'second') RETURNING id`;
      appA2 = first(a2).id;
      const e2 = await tx<{ id: string }[]>`
        INSERT INTO environments (tenant_id, application_id, type, status)
        VALUES (${TENANT_A}, ${appA2}, 'sandbox', 'active') RETURNING id`;
      envA2 = first(e2).id;

      const d = await tx<{ id: string }[]>`
        INSERT INTO message_definitions (tenant_id, application_id, key, status)
        VALUES (${TENANT_A}, ${appA}, 'order.shipped', 'active') RETURNING id`;
      defA = first(d).id;
      const v = await tx<{ id: string }[]>`
        INSERT INTO message_definition_versions
          (tenant_id, definition_id, application_id, version, variable_schema, content, default_locale)
        VALUES (${TENANT_A}, ${defA}, ${appA}, 1,
          ${JSON.stringify({ type: "object", properties: {} })}::jsonb,
          ${JSON.stringify({ body: "Order {{id}} shipped" })}::jsonb, 'en')
        RETURNING id`;
      verA1 = first(v).id;
      await tx`
        INSERT INTO message_definition_sender_bindings
          (tenant_id, application_id, environment_id, definition_id, sender_id)
        VALUES (${TENANT_A}, ${appA}, ${envA}, ${defA}, 'FABRIC')`;
      await tx`
        INSERT INTO message_definition_releases
          (tenant_id, application_id, environment_id, definition_id, version_id)
        VALUES (${TENANT_A}, ${appA}, ${envA}, ${defA}, ${verA1})`;
    });
  });

  afterAll(async () => {
    await cleanup();
    await db.end();
    await owner.end();
  });

  it("tenant A sees its own definition, version, and release", async () => {
    const seen = await db.withTenant(TENANT_A, async (tx) => {
      const d = await tx<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM message_definitions`;
      const v = await tx<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM message_definition_versions`;
      const r = await tx<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM message_definition_releases`;
      const s = await tx<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM message_definition_sender_bindings`;
      return { d: first(d).n, v: first(v).n, r: first(r).n, s: first(s).n };
    });
    expect(seen).toEqual({ d: 1, v: 1, r: 1, s: 1 });
  });

  it("tenant B sees zero of tenant A's definitions/versions/releases", async () => {
    const seen = await db.withTenant(TENANT_B, async (tx) => {
      const d = await tx<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM message_definitions`;
      const v = await tx<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM message_definition_versions`;
      const r = await tx<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM message_definition_releases`;
      const s = await tx<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM message_definition_sender_bindings`;
      return { d: first(d).n, v: first(v).n, r: first(r).n, s: first(s).n };
    });
    expect(seen, "tenant B must not see A's rows").toEqual({
      d: 0,
      v: 0,
      r: 0,
      s: 0,
    });
  });

  it("no app.tenant_id → 0 definitions (fail-closed)", async () => {
    const rows = await db.sql<
      { id: string }[]
    >`SELECT id FROM message_definitions`;
    expect(rows.length, "unset context sees nothing").toBe(0);
  });

  it("stable key is unique per application, case-insensitively", async () => {
    await expect(
      db.withTenant(TENANT_A, async (tx) => {
        await tx`
          INSERT INTO message_definitions (tenant_id, application_id, key, status)
          VALUES (${TENANT_A}, ${appA}, 'ORDER.SHIPPED', 'draft')`;
      }),
      "Order.Shipped must collide with order.shipped",
    ).rejects.toThrow();
  });

  it("a published version cannot be UPDATEd by the runtime role (immutability)", async () => {
    await expect(
      db.withTenant(TENANT_A, async (tx) => {
        await tx`
          UPDATE message_definition_versions
          SET content = ${JSON.stringify({ body: "tampered" })}::jsonb
          WHERE id = ${verA1}`;
      }),
      "runtime role has no UPDATE grant on versions",
    ).rejects.toThrow();
  });

  it("a published version cannot be DELETEd by the runtime role (immutability)", async () => {
    await expect(
      db.withTenant(TENANT_A, async (tx) => {
        await tx`DELETE FROM message_definition_versions WHERE id = ${verA1}`;
      }),
      "runtime role has no DELETE grant on versions",
    ).rejects.toThrow();
    // The row survives (assert via the owner, bypassing RLS).
    const survived = await owner.unsafe<{ n: number }[]>(
      "SELECT count(*)::int AS n FROM message_definition_versions WHERE id = $1",
      [verA1],
    );
    expect(first(survived).n).toBe(1);
  });

  it("only one active release per (environment, definition)", async () => {
    await expect(
      db.withTenant(TENANT_A, async (tx) => {
        await tx`
          INSERT INTO message_definition_releases
            (tenant_id, application_id, environment_id, definition_id, version_id)
          VALUES (${TENANT_A}, ${appA}, ${envA}, ${defA}, ${verA1})`;
      }),
      "a second release for the same env+definition must violate the unique index",
    ).rejects.toThrow();
  });

  it("a release cannot point into a different application (containment FK)", async () => {
    // envA2/appA2 belong to the second application; defA/verA1 belong to the first. The composite
    // definition containment FK (definition_id, tenant_id, application_id) makes this impossible.
    await expect(
      db.withTenant(TENANT_A, async (tx) => {
        await tx`
          INSERT INTO message_definition_releases
            (tenant_id, application_id, environment_id, definition_id, version_id)
          VALUES (${TENANT_A}, ${appA2}, ${envA2}, ${defA}, ${verA1})`;
      }),
      "cross-application release must fail the containment FK",
    ).rejects.toThrow();
  });

  it("a sender binding cannot point into a different application", async () => {
    await expect(
      db.withTenant(TENANT_A, async (tx) => {
        await tx`
          INSERT INTO message_definition_sender_bindings
            (tenant_id, application_id, environment_id, definition_id, sender_id)
          VALUES (${TENANT_A}, ${appA2}, ${envA2}, ${defA}, 'FABRIC')`;
      }),
      "cross-application sender binding must fail the containment FK",
    ).rejects.toThrow();
  });

  it("cross-tenant sender binding write is blocked by WITH CHECK", async () => {
    await expect(
      db.withTenant(TENANT_B, async (tx) => {
        await tx`
          INSERT INTO message_definition_sender_bindings
            (tenant_id, application_id, environment_id, definition_id, sender_id)
          VALUES (${TENANT_A}, ${appA}, ${envA}, ${defA}, 'EVIL')`;
      }),
    ).rejects.toThrow();
  });

  it("cross-tenant definition write is blocked by WITH CHECK", async () => {
    await expect(
      db.withTenant(TENANT_B, async (tx) => {
        await tx`
          INSERT INTO message_definitions (tenant_id, application_id, key, status)
          VALUES (${TENANT_A}, ${appA}, 'evil.key', 'draft')`;
      }),
    ).rejects.toThrow();
    const leaked = await owner.unsafe<{ n: number }[]>(
      "SELECT count(*)::int AS n FROM message_definitions WHERE key = 'evil.key'",
    );
    expect(first(leaked).n).toBe(0);
  });

  // ------------------------------------------------------------------------------------------
  // SDK-007 slice 1 — channel CHECK relax (ADR-0005 Amendment A1). The version channel column and the
  // delivery/attempt channel CHECKs must now accept 'email' and still reject any other value.
  // ------------------------------------------------------------------------------------------

  it("accepts an email-channel version through the runtime role (version channel CHECK allows email)", async () => {
    await db.withTenant(TENANT_A, async (tx) => {
      await tx`
        INSERT INTO message_definition_versions
          (tenant_id, definition_id, application_id, version, channel, variable_schema, content, default_locale)
        VALUES (${TENANT_A}, ${defA}, ${appA}, 2, 'email',
          ${JSON.stringify({ type: "object", properties: {} })}::jsonb,
          ${JSON.stringify({ subject: "Order shipped", html: "<p>on its way</p>" })}::jsonb, 'en')`;
    });
    const seen = await owner.unsafe<{ n: number }[]>(
      "SELECT count(*)::int AS n FROM message_definition_versions WHERE definition_id = $1 AND channel = 'email'",
      [defA],
    );
    expect(first(seen).n).toBe(1);
  });

  it("rejects a version whose channel is neither sms nor email (channel CHECK)", async () => {
    await expect(
      db.withTenant(TENANT_A, async (tx) => {
        await tx`
          INSERT INTO message_definition_versions
            (tenant_id, definition_id, application_id, version, channel, variable_schema, content, default_locale)
          VALUES (${TENANT_A}, ${defA}, ${appA}, 3, 'whatsapp',
            ${JSON.stringify({ type: "object", properties: {} })}::jsonb,
            ${JSON.stringify({ body: "x" })}::jsonb, 'en')`;
      }),
      "an unsupported channel must violate message_definition_version_channel_check",
    ).rejects.toThrow();
  });

  it("message_deliveries + attempts accept channel 'email' and reject a third value", async () => {
    const deliveryId = randomUUID();
    // A fully valid email delivery + attempt (superuser bypasses RLS/grants; the CHECK still applies).
    await owner.unsafe(
      `INSERT INTO message_deliveries
         (id, tenant_id, application_id, environment_id, definition_id, version_id, key, locale, channel,
          currency, idempotency_key, request_fingerprint, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'order.shipped', 'en', 'email',
          'GHS', 'idem-email-1', $7, now() + interval '1 day')`,
      [deliveryId, TENANT_A, appA, envA, defA, verA1, "a".repeat(64)],
    );
    // An email attempt must reference an email_messages row (0084 channel-message CHECK: channel='email'
    // ⇒ email_message_id NOT NULL, message_id NULL). Seed the minimal chain: data_subjects → email_messages.
    const subjectId = first(
      await owner.unsafe<{ subject_id: string }[]>(
        "INSERT INTO data_subjects (tenant_id) VALUES ($1) RETURNING subject_id",
        [TENANT_A],
      ),
    ).subject_id;
    const emailMessageId = first(
      await owner.unsafe<{ id: string }[]>(
        `INSERT INTO email_messages (tenant_id, application_id, environment_id, subject_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [TENANT_A, appA, envA, subjectId],
      ),
    ).id;
    await owner.unsafe(
      `INSERT INTO message_delivery_attempts
         (tenant_id, application_id, environment_id, delivery_id, ordinal, channel, email_message_id, currency)
       VALUES ($1, $2, $3, $4, 1, 'email', $5, 'GHS')`,
      [TENANT_A, appA, envA, deliveryId, emailMessageId],
    );
    const seen = await owner.unsafe<{ n: number }[]>(
      "SELECT count(*)::int AS n FROM message_delivery_attempts WHERE delivery_id = $1 AND channel = 'email'",
      [deliveryId],
    );
    expect(first(seen).n).toBe(1);

    // A third channel value is rejected on both tables by the relaxed CHECK.
    await expect(
      owner.unsafe(
        `INSERT INTO message_deliveries
           (id, tenant_id, application_id, environment_id, definition_id, version_id, key, locale, channel,
            currency, idempotency_key, request_fingerprint, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'order.shipped', 'en', 'whatsapp',
            'GHS', 'idem-wa-1', $7, now() + interval '1 day')`,
        [randomUUID(), TENANT_A, appA, envA, defA, verA1, "b".repeat(64)],
      ),
      "message_delivery_channel_check must reject 'whatsapp'",
    ).rejects.toThrow();
    await expect(
      owner.unsafe(
        `INSERT INTO message_delivery_attempts
           (tenant_id, application_id, environment_id, delivery_id, ordinal, channel, currency)
         VALUES ($1, $2, $3, $4, 2, 'whatsapp', 'GHS')`,
        [TENANT_A, appA, envA, deliveryId],
      ),
      "message_delivery_attempt_channel_check must reject 'whatsapp'",
    ).rejects.toThrow();
  });
});
