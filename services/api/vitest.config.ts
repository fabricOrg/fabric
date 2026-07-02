import { defineConfig } from "vitest/config";

// Default `test` run (pre-push `pnpm verify` / CI). EXCLUDES `*.integration.spec.ts` — those need a
// live, freshly-migrated Postgres (DATABASE_URL_SUPER/OWNER/APP) and run only via
// `pnpm --filter @app/api test:integration` (see vitest.integration.config.ts). Unit specs
// (api-key crypto/guard/controller) run here and stay DB-free.
export default defineConfig({
  test: {
    passWithNoTests: true,
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.integration.spec.ts"],
  },
});
