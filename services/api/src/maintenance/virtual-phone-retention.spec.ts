import type { ProvisioningDb } from "@app/db";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import type { SmsService } from "../sms/sms.service.js";
import type { VirtualPhoneService } from "../sms/virtual-phone.service.js";
import { MaintenanceService } from "./maintenance.service.js";

describe("scheduled Virtual Phone retention", () => {
  it("discovers expired tenants and invokes the tenant-scoped purge", async () => {
    let query = 0;
    const transaction = async (
      run: (tx: { execute: () => Promise<unknown[]> }) => Promise<unknown>,
    ) =>
      run({
        execute: async () => {
          query++;
          if (query === 1) return [{ locked: true }];
          if (query === 4) return [{ tenant_id: "tenant-1" }];
          return [];
        },
      });
    const provisioning = {
      db: { transaction },
    } as unknown as ProvisioningDb;
    const purgeExpired = vi.fn(
      async (_tenantId: string, _cutoffIso: string) => 3,
    );
    const virtualPhone = { purgeExpired } as unknown as VirtualPhoneService;
    const config = {
      get: (key: string) =>
        key === "VIRTUAL_PHONE_RETENTION_DAYS" ? "30" : "15",
    } as unknown as ConfigService;
    const service = new MaintenanceService(
      provisioning,
      { sweepStuck: async () => 0 } as unknown as SmsService,
      virtualPhone,
      config,
    );

    await service.runSweep();

    expect(purgeExpired).toHaveBeenCalledOnce();
    expect(purgeExpired.mock.calls[0]?.[0]).toBe("tenant-1");
    expect(
      new Date(purgeExpired.mock.calls[0]?.[1] ?? 0).getTime(),
    ).toBeLessThan(Date.now() - 29 * 86_400_000);
  });
});
