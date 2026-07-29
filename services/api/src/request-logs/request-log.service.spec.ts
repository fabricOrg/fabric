import type { AppDb, ProvisioningDb } from "@app/db";
import { describe, expect, it, vi } from "vitest";
import { RequestLogService } from "./request-log.service.js";

describe("RequestLogService buffering", () => {
  it("coalesces 100 request rows into one insert", async () => {
    const values = vi.fn(async (_rows: unknown[]) => undefined);
    const provisioning = {
      db: { insert: vi.fn(() => ({ values })) },
    } as unknown as ProvisioningDb;
    const service = new RequestLogService({} as AppDb, provisioning);

    for (let index = 0; index < 100; index += 1) {
      service.record({
        tenantId: "11111111-1111-4111-8111-111111111111",
        applicationId: null,
        environmentId: null,
        method: "GET",
        path: "/v1/messages",
        statusCode: 200,
        requestId: `req_${index}`,
        latencyMs: 5,
        keyId: "abcdef0123456789",
      });
    }
    await service.onModuleDestroy();

    expect(provisioning.db.insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledTimes(1);
    expect(values.mock.calls[0]?.[0]).toHaveLength(100);
  });
});
