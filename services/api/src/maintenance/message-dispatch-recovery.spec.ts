import type { ProvisioningDb } from "@app/db";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import type { SmsService } from "../sms/sms.service.js";
import type { VirtualPhoneService } from "../sms/virtual-phone.service.js";
import { MaintenanceService } from "./maintenance.service.js";

describe("scheduled durable message dispatch recovery", () => {
  it("discovers tenants with pending intents and re-enqueues them", async () => {
    let query = 0;
    const transaction = async (
      run: (tx: { execute: () => Promise<unknown[]> }) => Promise<unknown>,
    ) =>
      run({
        execute: async () => {
          query++;
          return query === 1
            ? [{ locked: true }]
            : [{ tenant_id: "tenant-1" }, { tenant_id: "tenant-2" }];
        },
      });
    const enqueuePending = vi
      .fn<(tenantId: string) => Promise<number>>()
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    const service = new MaintenanceService(
      { db: { transaction } } as unknown as ProvisioningDb,
      { enqueuePending } as unknown as SmsService,
      {} as VirtualPhoneService,
      { get: () => undefined } as unknown as ConfigService,
    );

    await expect(service.runDispatchRecovery()).resolves.toEqual({
      locked: true,
      enqueued: 3,
    });
    expect(enqueuePending).toHaveBeenNthCalledWith(1, "tenant-1");
    expect(enqueuePending).toHaveBeenNthCalledWith(2, "tenant-2");
  });

  it("the production cron entry invokes recovery when maintenance is enabled", async () => {
    const service = new MaintenanceService(
      {} as ProvisioningDb,
      {} as SmsService,
      {} as VirtualPhoneService,
      { get: () => undefined } as unknown as ConfigService,
    );
    const recovery = vi
      .spyOn(service, "runDispatchRecovery")
      .mockResolvedValue({ locked: true, enqueued: 0 });

    await service.dispatchTick();

    expect(recovery).toHaveBeenCalledOnce();
  });
});
