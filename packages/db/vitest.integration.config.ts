import { defineConfig } from "vitest/config";

// Integration tier — run explicitly via `pnpm --filter @app/db test:integration` against a live,
// freshly-migrated Postgres (set DATABASE_URL_OWNER for migrate/seed as owner, DATABASE_URL_APP for
// the RLS-enforced runtime assertions as app_runtime). Runs ONLY `*.integration.spec.ts`
// (e.g. the ledger reserve/commit/refund invariant + tenant-isolation specs). Never part of the
// default `test` run — see vitest.config.ts.
export default defineConfig({
  test: {
    include: ["**/*.integration.spec.ts"],
    // DB round-trips + SET LOCAL tenant context per test; keep generous and serial to avoid
    // cross-test interference on the shared connection pool.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
