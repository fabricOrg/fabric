import type { AppDb } from "@app/db";
import { describe, expect, it, vi } from "vitest";
import { ApiKeyService } from "./api-keys.service.js";

describe("ApiKeyService telemetry", () => {
  it("throttles last-used writes for repeated use of one key", async () => {
    const touch = vi.fn(async () => []);
    const lookup = vi.fn(async () => [
      {
        tenant_id: "11111111-1111-4111-8111-111111111111",
        scopes: ["sms:read"],
        application_id: null,
        environment_id: null,
      },
    ]);
    const db = {
      withApiKeyLookup: async () => lookup(),
      withTenant: async (
        _tenantId: string,
        operation: (tx: typeof touch) => Promise<unknown>,
      ) => operation(touch),
    } as unknown as AppDb;
    const service = new ApiKeyService(db);
    const rawKey = `sk_test_${"a".repeat(40)}`;

    await service.resolve(rawKey);
    await service.resolve(rawKey);
    await Promise.resolve();

    expect(lookup).toHaveBeenCalledTimes(2);
    expect(touch).toHaveBeenCalledTimes(1);
  });
});
