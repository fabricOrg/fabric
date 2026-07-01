import { defineConfig } from "vitest/config";

// Default `test` run — EXCLUDES `*.integration.spec.ts` (they need a live migrated Postgres and run
// only via `test:integration`). Mirrors @app/db so a DB-backed spec can't redden pre-push.
export default defineConfig({
  test: {
    passWithNoTests: true,
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.integration.spec.ts"],
  },
});
