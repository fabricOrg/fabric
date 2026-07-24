import { describe, expect, it, vi } from "vitest";
import type { ConsentService } from "../consent/consent.service.js";
import type { SendersService } from "../senders/senders.service.js";
import { assertSendCompliant, assessSendCompliance } from "./sms-compliance.js";

function dependencies(input?: {
  senderStatus?: "active" | "pending" | "rejected" | "unregistered";
  suppressed?: boolean;
}) {
  const senderStatus = vi.fn(async () => input?.senderStatus ?? "active");
  const isSuppressed = vi.fn(async () => input?.suppressed ?? false);
  return {
    senderStatus,
    isSuppressed,
    senders: { senderStatus } as unknown as SendersService,
    consent: { isSuppressed } as unknown as ConsentService,
  };
}

describe("shared send compliance assessment", () => {
  it("warns without a recipient and performs no recipient lookup", async () => {
    const deps = dependencies();
    const result = await assessSendCompliance({
      ...deps,
      tenantId: "tenant",
      senderId: "FABRIC",
      messageClass: "transactional",
      virtual: false,
    });
    expect(result).toMatchObject({
      senderStatus: "not_evaluated",
      blockers: [],
      warnings: [{ code: "recipient_not_provided", path: "to" }],
    });
    expect(deps.senderStatus).not.toHaveBeenCalled();
    expect(deps.isSuppressed).not.toHaveBeenCalled();
  });

  it("returns sender, suppression, and quiet-hour blockers together", async () => {
    const deps = dependencies({ senderStatus: "pending", suppressed: true });
    const result = await assessSendCompliance({
      ...deps,
      tenantId: "tenant",
      to: "+233201234567",
      senderId: "FABRIC",
      messageClass: "promotional",
      virtual: false,
      now: new Date("2026-07-19T12:00:00.000Z"),
    });
    expect(result.senderStatus).toBe("pending");
    expect(result.blockers.map((blocker) => blocker.code)).toEqual([
      "sender_not_registered",
      "recipient_opted_out",
      "promo_quiet_hours",
    ]);
  });

  it("makes the send path fail closed on the same first blocker", async () => {
    const deps = dependencies({ senderStatus: "rejected" });
    await expect(
      assertSendCompliant({
        ...deps,
        tenantId: "tenant",
        to: "+2348012345678",
        senderId: "FABRIC",
        messageClass: "transactional",
        virtual: false,
      }),
    ).rejects.toMatchObject({
      status: 400,
      response: { error: { code: "sender_not_registered" } },
    });
  });
});
