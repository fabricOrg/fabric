import type { AppDb } from "@app/db";
import { HttpException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import type { AuditService } from "../audit/audit.service.js";
import type { PluginResolverService } from "../plugins/plugin-resolver.service.js";
import type { PiiVaultService } from "../privacy/pii-vault.service.js";
import { VirtualPhoneService } from "./virtual-phone.service.js";

function service(resolveSms: () => Promise<unknown>): {
  virtualPhone: VirtualPhoneService;
  withTenant: ReturnType<typeof vi.fn>;
} {
  const withTenant = vi
    .fn()
    .mockResolvedValueOnce([
      {
        plan: "free",
        settings: { messaging: { delivery_mode: "virtual" } },
      },
    ])
    .mockResolvedValueOnce([{ approved: 1 }])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      {
        plan: "free",
        settings: { messaging: { delivery_mode: "live" } },
      },
    ]);
  const db = { withTenant } as unknown as AppDb;
  const config = {
    get: (key: string) => {
      if (key === "NODE_ENV") return "production";
      if (key === "SMS_PROVIDER") return "fake";
      return undefined;
    },
  } as unknown as ConfigService;
  const audit = {
    record: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  const vault = {} as PiiVaultService;
  const resolver = { resolveSms } as unknown as PluginResolverService;
  return {
    virtualPhone: new VirtualPhoneService(db, config, audit, vault, resolver),
    withTenant,
  };
}

describe("VirtualPhoneService live plugin readiness", () => {
  it("allows live mode when a live plugin resolves even if the env fallback is fake", async () => {
    const resolveSms = vi.fn().mockResolvedValue({ vendor: "arkesel" });
    const { virtualPhone, withTenant } = service(resolveSms);

    await expect(
      virtualPhone.updateSettings(
        "11111111-1111-1111-1111-111111111111",
        "live",
      ),
    ).resolves.toMatchObject({ delivery_mode: "live", locked: false });

    expect(resolveSms).toHaveBeenCalledWith("live");
    expect(withTenant).toHaveBeenCalledTimes(4);
  });

  it("still rejects live mode when neither a plugin nor the env fallback is ready", async () => {
    const { virtualPhone } = service(async () => null);

    await expect(
      virtualPhone.updateSettings(
        "11111111-1111-1111-1111-111111111111",
        "live",
      ),
    ).rejects.toSatisfy(
      (error) =>
        error instanceof HttpException &&
        error.getStatus() === 400 &&
        JSON.stringify(error.getResponse()).includes("live_provider_not_ready"),
    );
  });

  it("fails closed with a safe error when plugin resolution is unavailable", async () => {
    const { virtualPhone } = service(async () => {
      throw new Error("database connection secret detail");
    });

    await expect(
      virtualPhone.updateSettings(
        "11111111-1111-1111-1111-111111111111",
        "live",
      ),
    ).rejects.toSatisfy((error) => {
      if (!(error instanceof HttpException)) return false;
      const response = JSON.stringify(error.getResponse());
      return (
        response.includes("live_provider_not_ready") &&
        !response.includes("database connection secret detail")
      );
    });
  });
});
