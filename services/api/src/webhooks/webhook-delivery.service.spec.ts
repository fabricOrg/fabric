import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import { WebhookDeliveryService } from "./webhook-delivery.service.js";
import type { WebhookDeliveryStore } from "./webhook-delivery.store.js";

const store = {
  healthSnapshot: async () => ({
    pending: 0,
    dead: 0,
    retriesLastHour: 0,
    oldestPendingSeconds: 0,
  }),
} as WebhookDeliveryStore;

describe("WebhookDeliveryService scheduled trigger", () => {
  it("invokes the real sweep from the production cron caller", async () => {
    const service = new WebhookDeliveryService(store, {
      get: () => undefined,
    } as unknown as ConfigService);
    const sweep = vi.spyOn(service, "deliverPending").mockResolvedValue({
      claimed: 0,
      delivered: 0,
      retried: 0,
      dead: 0,
    });
    vi.spyOn(service, "healthSnapshot").mockResolvedValue({
      pending: 0,
      dead: 0,
      retriesLastHour: 0,
      oldestPendingSeconds: 0,
    });
    await service.tick();
    expect(sweep).toHaveBeenCalledOnce();
  });

  it("does not sweep when maintenance cron is explicitly disabled", async () => {
    const service = new WebhookDeliveryService(store, {
      get: () => "false",
    } as unknown as ConfigService);
    const sweep = vi.spyOn(service, "deliverPending");
    await service.tick();
    expect(sweep).not.toHaveBeenCalled();
  });
});
