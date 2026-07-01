import { defineConfig } from "vitest/config";

// Default `test` — EXCLUDES `*.integration.spec.ts` (they need a live migrated Postgres). Mirrors
// @app/db/@app/wallet so a DB-backed spec can't redden pre-push.
export default defineConfig({
  test: {
    passWithNoTests: true,
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.integration.spec.ts"],
  },
});
