import { describe, expect, it } from "vitest";
import type { NormalizedMessage } from "../plugin.js";
import { VirtualPhoneProvider } from "./provider.js";

const provider = new VirtualPhoneProvider();

function message(to: string): NormalizedMessage {
  return {
    messageId: "00000000-0000-4000-8000-000000000001",
    to,
    senderId: "SANDBOX",
    body: "test",
    encoding: "gsm7",
    segments: 1,
  };
}

describe("VirtualPhoneProvider test recipients", () => {
  it.each([
    ["+233500000000", "undelivered", "virtual_carrier_rejected"],
    ["+233500000001", "failed", "virtual_platform_fault"],
    ["+233500000002", "delivered", undefined],
    ["+233500000003", "delivered", undefined],
    ["+233545227189", "delivered", undefined],
  ] as const)("maps %s to %s", (to, status, errorCode) => {
    const dlr = provider.delivered(message(to));
    expect(dlr.status).toBe(status);
    expect(dlr.errorCode).toBe(errorCode);
    expect(provider.parseDlr(dlr).status).toBe(status);
  });

  it("marks platform fault 0001 as refundable", () => {
    expect(
      provider.parseDlr(provider.delivered(message("+233500000001"))),
    ).toMatchObject({ status: "failed", faultCause: "internal_error" });
  });
});
