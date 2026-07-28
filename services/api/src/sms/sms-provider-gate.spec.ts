import { randomUUID } from "node:crypto";
import type { AppDb } from "@app/db";
import { HttpException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import type { ConsentService } from "../consent/consent.service.js";
import type { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import type { AutoTopupService } from "../payments/auto-topup.service.js";
import type { PricingService } from "../pricing/pricing.service.js";
import type { PiiVaultService } from "../privacy/pii-vault.service.js";
import type { QueueService } from "../queue/queue.service.js";
import type { SendersService } from "../senders/senders.service.js";
import { SmsService } from "./sms.service.js";
import type { VirtualPhoneService } from "./virtual-phone.service.js";

/**
 * PROVIDER KILL-SWITCH GATE — unit spec (finding 9). Before finding 9 the provider switches were
 * dead config. Now send() must fail CLOSED when the ACTIVE provider's `provider.<slug>` switch is
 * paused — never fake success, never fall through to a send. The default (fake-sms) provider has
 * no switch, so an un-paused platform sends normally. tx1/engine are never reached here — the gate
 * short-circuits — so no DB is needed.
 */

// F3: send() first reads the tenant plan to route sandbox tenants at the fake provider. A LIVE
// plan keeps this spec exercising the provider kill-switch gate (sandbox skips it — the fake
// provider has nothing risky to halt).
const db = {
  withTenant: async () => [{ plan: "free" }],
} as unknown as AppDb;
const autoTopup = {
  maybeAutoTopUp: async () => undefined,
} as unknown as AutoTopupService;
const config = { get: () => undefined } as unknown as ConfigService; // provider = fake-sms
const queue = { enabled: false } as unknown as QueueService;
// E10-S4: sender enforcement has its own spec — always registered here.
const senderStub = {
  senderStatus: async () => "active" as const,
} as unknown as SendersService;
const consentStub = {
  isSuppressed: async () => false,
} as unknown as ConsentService;
const virtualPhoneStub = {
  resolveMode: async () => "live",
} as unknown as VirtualPhoneService;
// No db in this spec — the gate must reject before the send path ever tokenizes a recipient.
const vaultStub = {
  subjectForPhone: async () => randomUUID(),
} as unknown as PiiVaultService;
// These gate tests reject before the send path reaches pricing; the stub is never consulted.
const pricingStub = {
  resolveRates: async () => ({ sms: {}, email: {} }),
} as unknown as PricingService;

function serviceWithSwitch(paused: Record<string, boolean>): {
  svc: SmsService;
  isPaused: ReturnType<typeof vi.fn>;
} {
  const isPaused = vi.fn(async (key: string) => paused[key] ?? false);
  const killSwitch = { isPaused } as unknown as KillSwitchService;
  return {
    svc: new SmsService(
      db,
      autoTopup,
      killSwitch,
      config,
      queue,
      senderStub,
      consentStub,
      virtualPhoneStub,
      vaultStub,
      pricingStub,
    ),
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
