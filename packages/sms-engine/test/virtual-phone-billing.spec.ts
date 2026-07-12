import { decideResolution } from "@app/domain";
import { VirtualPhoneProvider } from "@app/integrations";
import { describe, expect, it } from "vitest";

const provider = new VirtualPhoneProvider();

describe("Virtual Phone billing outcomes", () => {
  it.each([
    ["accepted", undefined, "none"],
    ["delivered", undefined, "refund"],
    ["undelivered", undefined, "commit"],
    ["failed", "internal_error", "refund"],
  ] as const)("resolves %s / %s as %s", (status, faultCause, expected) => {
    expect(
      decideResolution({
        newStatus: status,
        reachedBillable: false,
        billableStatuses: provider.billableStatuses,
        platformFaultExemptions: provider.platformFaultExemptions,
        ...(faultCause ? { faultCause } : {}),
      }),
    ).toBe(expected);
  });
});
