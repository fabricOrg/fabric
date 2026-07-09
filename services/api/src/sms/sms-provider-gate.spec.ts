import type { AppDb } from "@app/db";
import { HttpException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import type { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import type { AutoTopupService } from "../payments/auto-topup.service.js";
import type { QueueService } from "../queue/queue.service.js";
import { SmsService } from "./sms.service.js";

/**
 * PROVIDER KILL-SWITCH GATE — unit spec (finding 9). Before finding 9 the provider switches were
 * dead config. Now send() must fail CLOSED when the ACTIVE provider's `provider.<slug>` switch is
 * paused — never fake success, never fall through to a send. The default (fake-sms) provider has
 * no switch, so an un-paused platform sends normally. tx1/engine are never reached here — the gate
 * short-circuits — so no DB is needed.
 */

const db = {} as AppDb;
const autoTopup = {
  maybeAutoTopUp: async () => undefined,
} as unknown as AutoTopupService;
const config = { get: () => undefined } as unknown as ConfigService; // provider = fake-sms
const queue = { enabled: false } as unknown as QueueService;

function serviceWithSwitch(paused: Record<string, boolean>): {
  svc: SmsService;
  isPaused: ReturnType<typeof vi.fn>;
} {
  const isPaused = vi.fn(async (key: string) => paused[key] ?? false);
  const killSwitch = { isPaused } as unknown as KillSwitchService;
  return {
    svc: new SmsService(db, autoTopup, killSwitch, config, queue),
    isPaused,
  };
}

const input = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  to: "+233201234567",
  senderId: "FABRIC",
  body: "gate test",
  currency: "GHS",
};

describe("SmsService provider kill-switch gate", () => {
  it("fails closed with provider_unavailable when the active provider is paused", async () => {
    const { svc, isPaused } = serviceWithSwitch({ "provider.fake-sms": true });
    await expect(svc.send(input)).rejects.toSatisfy(
      (e) => e instanceof HttpException && e.getStatus() === 400,
    );
    // Gated on the ACTIVE provider's slug — never faked a send.
    expect(isPaused).toHaveBeenCalledWith("provider.fake-sms");
  });

  it("checks the global switch before the provider switch", async () => {
    const { svc, isPaused } = serviceWithSwitch({
      "platform.sms_sending": true,
    });
    await expect(svc.send(input)).rejects.toBeInstanceOf(HttpException);
    expect(isPaused).toHaveBeenCalledWith("platform.sms_sending");
  });
});
