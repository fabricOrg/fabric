import { defineConfig } from "vitest/config";

// Default `test` run (pre-commit is staged-only, but pre-push `pnpm verify` + CI `turbo run test`
// use this). It EXCLUDES `*.integration.spec.ts`: those need a live, freshly-migrated Postgres
// (DATABASE_URL_OWNER/APP) and run only via `pnpm --filter @app/db test:integration`
// (see vitest.integration.config.ts). Keeping them out of the default run means adding a DB-backed
// spec can't redden everyone's pre-push.
//
// passWithNoTests: @app/db currently ships only framework-agnostic *.check.ts helpers (imported by
// the integration specs + the standing CI gate) and no unit *.spec.ts yet — the default run must
// succeed with zero matched files rather than error.
export default defineConfig({
  test: {
    passWithNoTests: true,
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/migrations/**",
      "**/*.integration.spec.ts",
    ],
  },
});
