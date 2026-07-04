import { describe, expect, it } from "vitest";
import { provisioningDatabaseUrl } from "./provisioning-db.module.js";

function config(values: Record<string, string | undefined>) {
  return {
    get: (name: string) => values[name],
  };
}

describe("provisioning database configuration", () => {
  it("uses the dedicated provisioning role when configured", () => {
    expect(
      provisioningDatabaseUrl(
        config({
          NODE_ENV: "production",
          DATABASE_URL_PROVISIONER: "postgres://provisioner",
          DATABASE_URL_SUPER: "postgres://owner",
        }),
      ),
    ).toBe("postgres://provisioner");
  });

  it("allows the bootstrap-role fallback outside production", () => {
    expect(
      provisioningDatabaseUrl(
        config({
          NODE_ENV: "development",
          DATABASE_URL_SUPER: "postgres://owner",
        }),
      ),
    ).toBe("postgres://owner");
  });

  it("rejects a production superuser fallback", () => {
    expect(() =>
      provisioningDatabaseUrl(
        config({
          NODE_ENV: "production",
          DATABASE_URL_SUPER: "postgres://owner",
        }),
      ),
    ).toThrow(
      "DATABASE_URL_PROVISIONER is required for identity provisioning.",
    );
  });
});
