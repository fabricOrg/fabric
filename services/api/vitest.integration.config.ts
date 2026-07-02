import { defineConfig } from "vitest/config";

// Integration tier — `pnpm --filter @app/api test:integration` against a live DB migrated AS
// app_migrator (prod-faithful owner). Env: DATABASE_URL_SUPER (app_owner, cross-tenant seeds),
// DATABASE_URL_APP (app_runtime, RLS-enforced). Runs ONLY `*.integration.spec.ts`; serial to avoid
// cross-test interference on the shared pool.
export default defineConfig({
  test: {
    include: ["**/*.integration.spec.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
