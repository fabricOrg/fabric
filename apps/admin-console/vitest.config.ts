import { defineConfig } from "vitest/config";

// Admin-console unit tests — pure server/logic units (the CSRF origin gate, money formatting,
// form-schema validation). Node environment: no DOM. Component/interaction coverage (row-action
// guards) + a Playwright staff-console smoke are a deliberate follow-up (A2 note) — they need
// jsdom/@testing-library + a browser harness this app doesn't carry yet.
export default defineConfig({
  // `server-only` is a Next build-time marker with no runtime module vitest can resolve; alias it
  // to an empty module so server-lib specs (origin gate, etc.) load under the node test runner.
  resolve: {
    alias: {
      "server-only": new URL("./test/empty.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    include: ["**/*.spec.ts"],
    exclude: ["**/node_modules/**", "**/.next/**"],
    passWithNoTests: true,
  },
});
