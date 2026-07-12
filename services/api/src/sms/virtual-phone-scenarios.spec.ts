import type { SendInput, SendResult } from "@app/sms-engine";
import { describe, expect, it, vi } from "vitest";
import { virtualDlrDelayMs } from "./sms-dispatch.js";
import type { VirtualPhoneService } from "./virtual-phone.service.js";
import { maybeAutoStop } from "./virtual-phone-auto-stop.js";

const base = {
  tenantId: "00000000-0000-4000-8000-000000000001",
  senderId: "SANDBOX",
  body: "test",
  currency: "GHS",
  deliveryMode: "virtual",
  subjectId: "00000000-0000-4000-8000-000000000002",
} satisfies Omit<SendInput, "to">;

describe("Virtual Phone scenarios", () => {
  it("delays only the 0002 DLR", () => {
    expect(virtualDlrDelayMs("+233500000002")).toBe(2_000);
    expect(virtualDlrDelayMs("+233500000003")).toBe(0);
  });

  it("creates automatic STOP only after delivered 0003", async () => {
    const reply = vi.fn(async () => ({
      id: randomUUID(),
      keyword: "STOP" as const,
      consent_changed: true,
    }));
    const phone = { reply } as unknown as VirtualPhoneService;
    const delivered = { status: "delivered" } as SendResult;
    await maybeAutoStop(phone, { ...base, to: "+233500000003" }, delivered);
    await maybeAutoStop(phone, { ...base, to: "+233500000004" }, delivered);
    expect(reply).toHaveBeenCalledOnce();
    expect(reply).toHaveBeenCalledWith(base.tenantId, {
      to: "+233500000003",
      body: "STOP",
    });
  });
});

import { randomUUID } from "node:crypto";
