import { defineConfig } from "vitest/config";

// The impersonation seal derives its key with `scryptSync`, which is CPU-bound BY DESIGN — that cost
// is the security property, so the spec must not be made cheaper to fit a timeout. Under
// `verify:push` Turbo runs ~22 tasks at once and a single derivation can exceed vitest's 5s default,
// which failed a push with "Test timed out in 5000ms" on a suite that passes in well under a second
// when run alone. Raised rather than weakened.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    passWithNoTests: true,
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
