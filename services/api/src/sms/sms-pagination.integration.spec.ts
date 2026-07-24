// ============================================================================================
// SMS list cursor pagination against a real migrated DB + RLS. Guards the microsecond-precision
// keyset: rows sharing a millisecond (a batch shares one created_at, and sub-ms neighbours are
// common under load) must page through with NO skips and NO duplicates. A bare `::timestamptz`
// cast on the driver-bound cursor truncates to ms and silently drops rows — this test fails if
// that regresses. tier: test:integration.
// ============================================================================================

import { randomUUID } from "node:crypto";
import { type AppDb, createAppDb } from "@app/db";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeCursor } from "../http/cursor.js";
import { listMessages } from "./sms-read.js";

const SUPER_URL = process.env.DATABASE_URL_SUPER;
const APP_URL = process.env.DATABASE_URL_APP;
const describeDb = SUPER_URL && APP_URL ? describe : describe.skip;

const owner = postgres(SUPER_URL ?? "", { max: 2 });
const appDb: AppDb = createAppDb(APP_URL ?? "", { max: 1 });

const TENANT = randomUUID();
let envId = "";

// Six rows: THREE share one microsecond-identical created_at (a batch — exercises the id
// tiebreak), one lands sub-millisecond away inside the same ms, two are earlier. Ids are UUIDs;
// the paged walk is asserted against Postgres's OWN ordering (a single unpaged query), never a
// JS re-derivation of the sort — re-implementing (created_at DESC, id DESC) in JS is fragile
// (uuid byte order vs string codepoint, timestamptz vs ISO string) and drifts from the DB.
const BASE = "2026-07-24T10:00:00";
const seedRows = [
  { id: randomUUID(), createdAt: `${BASE}.600789Z` },
  { id: randomUUID(), createdAt: `${BASE}.600789Z` },
  { id: randomUUID(), createdAt: `${BASE}.600789Z` },
  { id: randomUUID(), createdAt: `${BASE}.600123Z` },
  { id: randomUUID(), createdAt: `${BASE}.599999Z` },
  { id: randomUUID(), createdAt: `${BASE}.500000Z` },
];

describeDb("SMS list cursor pagination (microsecond keyset)", () => {
  beforeAll(async () => {
    await owner.unsafe(
      "INSERT INTO accounts (id, name, slug) VALUES ($1, 'Pagination', $2) ON CONFLICT (id) DO NOTHING",
      [TENANT, `pg-${TENANT}`],
    );
    const apps = (await owner.unsafe(
      `INSERT INTO applications (tenant_id, name, slug) VALUES ($1, 'Default', 'default')
       ON CONFLICT (tenant_id, slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id`,
      [TENANT],
    )) as unknown as Array<{ id: string }>;
    const appId = apps[0]?.id ?? "";
    const envs = (await owner.unsafe(
      `INSERT INTO environments (tenant_id, application_id, type, status)
       VALUES ($1, $2, 'sandbox', 'active')
       ON CONFLICT (application_id, type) DO UPDATE SET status = EXCLUDED.status RETURNING id`,
      [TENANT, appId],
    )) as unknown as Array<{ id: string }>;
    envId = envs[0]?.id ?? "";
    for (const row of seedRows) {
      await owner.unsafe(
        `INSERT INTO messages
           (id, tenant_id, environment_id, sender_id, status, encoding, segments,
            cost_minor, currency, created_at)
         VALUES ($1, $2, $3, 'Fabric', 'delivered', 'gsm7', 1, 1000, 'GHS', $4::timestamptz)`,
        [row.id, TENANT, envId, row.createdAt],
      );
    }
  });

  afterAll(async () => {
    await owner`DELETE FROM messages WHERE tenant_id = ${TENANT}`;
    await owner`DELETE FROM accounts WHERE id = ${TENANT}`;
    await Promise.all([owner.end(), appDb.end()]);
  });

  it("walks every row exactly once across ms-colliding pages", async () => {
    // Canonical order = one unpaged query through the same read path. The paged walk must
    // reproduce it exactly: any skip, duplicate, or cross-page reorder from a truncated cursor
    // shows up as a divergence here.
    const full = await listMessages(appDb, TENANT, envId, { limit: 1000 });
    const canonical = full.messages.map((m) => m.id);
    expect(canonical).toHaveLength(seedRows.length);
    expect(new Set(canonical).size).toBe(seedRows.length);

    const seen: string[] = [];
    let cursor: string | undefined;
    // limit 2 forces a page boundary inside the three-row microsecond collision.
    for (let guard = 0; guard < 10; guard++) {
      const page = await listMessages(appDb, TENANT, envId, {
        limit: 2,
        ...(cursor ? { before: decodeCursor(cursor) } : {}),
      });
      seen.push(...page.messages.map((m) => m.id));
      if (!page.next_cursor) break;
      cursor = page.next_cursor;
    }
    expect(seen).toEqual(canonical);
  });
});
