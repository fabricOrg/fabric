import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./", import.meta.url).pathname,
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
