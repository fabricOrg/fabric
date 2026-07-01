import { defineConfig } from "vitest/config";

// Integration tier — `pnpm --filter @app/wallet test:integration` against a fresh migrated Postgres
// (DATABASE_URL_OWNER for seed/global sweep, DATABASE_URL_APP for the RLS runtime path). Runs ONLY
// `*.integration.spec.ts`; serial to avoid pool interference.
export default defineConfig({
  test: {
    include: ["**/*.integration.spec.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
