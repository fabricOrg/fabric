import { defineConfig } from "vitest/config";

// Integration tier — `pnpm --filter @app/api test:integration` against a live DB migrated AS
// app_migrator (prod-faithful owner). Env: DATABASE_URL_SUPER (app_owner, cross-tenant seeds),
// DATABASE_URL_APP (app_runtime, RLS-enforced). Runs ONLY `*.integration.spec.ts`; serial to avoid
// cross-test interference on the shared pool.
export default defineConfig({
  test: {
    include: ["**/*.integration.spec.ts"],
    // A remote Neon branch can take more than 30 seconds for transaction-heavy API cases.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
