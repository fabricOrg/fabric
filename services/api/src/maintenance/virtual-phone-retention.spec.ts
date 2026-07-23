import type { ProvisioningDb } from "@app/db";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import type { EmailService } from "../email/email.service.js";
import type { SmsService } from "../sms/sms.service.js";
import type { VirtualPhoneService } from "../sms/virtual-phone.service.js";
import { MaintenanceService } from "./maintenance.service.js";

describe("scheduled Virtual Phone retention", () => {
  it("discovers stale managed email tenants and invokes the email sweeper", async () => {
    let query = 0;
    const transaction = async (
      run: (tx: { execute: () => Promise<unknown[]> }) => Promise<unknown>,
    ) =>
      run({
        execute: async () => {
          query++;
          if (query === 1) return [{ locked: true }];
          if (query === 3) return [{ tenant_id: "tenant-email" }];
          return [];
        },
      });
    const sweepStuck = vi.fn<
      (tenantId: string, cutoffIso: string) => Promise<number>
    >(async () => 2);
    const service = new MaintenanceService(
      { db: { transaction } } as unknown as ProvisioningDb,
      { sweepStuck: async () => 0 } as unknown as SmsService,
      { sweepStuck } as unknown as EmailService,
      { purgeExpired: async () => 0 } as unknown as VirtualPhoneService,
      { get: () => "15" } as unknown as ConfigService,
    );

    const result = await service.runSweep();

    expect(sweepStuck).toHaveBeenCalledOnce();
    expect(sweepStuck.mock.calls[0]?.[0]).toBe("tenant-email");
    expect(result.sweptTenants["tenant-email"]).toBe(2);
  });

  it("discovers expired tenants and invokes the tenant-scoped purge", async () => {
    let query = 0;
    const transaction = async (
      run: (tx: { execute: () => Promise<unknown[]> }) => Promise<unknown>,
    ) =>
      run({
        execute: async () => {
          query++;
          if (query === 1) return [{ locked: true }];
          if (query === 5) return [{ tenant_id: "tenant-1" }];
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
      { sweepStuck: async () => 0 } as unknown as EmailService,
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
