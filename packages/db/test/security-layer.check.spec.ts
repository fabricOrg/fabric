import { describe, expect, it } from "vitest";
import {
  checkSecurityLayerApplied,
  TENANT_TABLES,
} from "./security-layer.check.js";

describe("security layer managed-role handling", () => {
  it("scopes the BYPASSRLS audit to application-owned roles", async () => {
    const queries: string[] = [];
    await checkSecurityLayerApplied(
      {
        query: async (sql) => {
          queries.push(sql);
          if (sql.includes("FROM pg_roles WHERE rolname = 'app_runtime'")) {
            return { rows: [{ rolbypassrls: false }] };
          }
          if (sql.includes("FROM pg_class c JOIN pg_namespace")) {
            return {
              rows: TENANT_TABLES.map((relname) => ({
                relname,
                relforcerowsecurity: true,
              })),
            };
          }
          if (sql.includes("FROM pg_policies")) {
            return {
              rows: TENANT_TABLES.map((tablename) => ({ tablename, n: 1 })),
            };
          }
          if (sql.includes("WHERE rolname = 'app_migrator'")) {
            return { rows: [{ rolsuper: false }] };
          }
          return { rows: [] };
        },
      },
      TENANT_TABLES,
    );

    expect(
      queries.find((sql) => sql.includes("rolbypassrls = true")),
    ).toContain("rolname LIKE 'app\\_%'");
  });
});
