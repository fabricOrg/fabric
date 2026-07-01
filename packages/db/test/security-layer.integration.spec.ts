// ============================================================================================
// SECURITY-LAYER-APPLIED — integration spec (QA / adams). Closes the #1 P0 (RLS-not-wired) with
// evidence: asserts a FRESHLY-MIGRATED DB actually has the security layer, via the canonical
// `db:migrate` path (journal 0000/0001/0002), NOT hand-applied SQL.
//
// Runs as OWNER (DATABASE_URL_OWNER) — reads pg_roles / pg_class / pg_policies / role_table_grants,
// all readable by the owner. Tier: `test:integration` (vitest.integration.config.ts).
// ============================================================================================

import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import {
  checkSecurityLayerApplied,
  formatSecurityViolations,
} from "./security-layer.check.js";

const OWNER_URL = process.env.DATABASE_URL_OWNER;
if (!OWNER_URL) {
  throw new Error(
    "test:integration requires DATABASE_URL_OWNER (fresh/isolated migrated DB)",
  );
}
const owner = postgres(OWNER_URL, { max: 2 });

type Row = Record<string, unknown>;

describe("security layer applied (RLS + roles + append-only)", () => {
  afterAll(async () => {
    await owner.end();
  });

  it("a freshly db:migrate'd DB has the full security layer", async () => {
    const r = await checkSecurityLayerApplied({
      query: async (q) => ({ rows: (await owner.unsafe(q)) as Row[] }),
    });
    expect(r.ok, formatSecurityViolations(r)).toBe(true);
  });
});
