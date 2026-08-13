import { updateSandboxAllowancePolicySchema } from "@app/contracts";
import { describe, expect, it } from "vitest";
import { sandboxAllowanceIssueMessage } from "./sandbox-allowance-message.js";

const VALID = {
  sms_segments_per_day: 100,
  email_messages_per_day: 200,
  whatsapp_messages_per_day: 100,
  reason: "raising the cap for a pilot",
};

function messageFor(body: unknown): string {
  const parsed = updateSandboxAllowancePolicySchema.safeParse(body);
  if (parsed.success) throw new Error("expected the body to be rejected");
  return sandboxAllowanceIssueMessage(parsed.error);
}

describe("sandboxAllowanceIssueMessage", () => {
  // The originating bug: the editor omitted this field entirely, and the operator was shown a line
  // about the two fields they had filled in correctly. Zod's own message here is
  // "Invalid input: expected number, received undefined" — which names no field either.
  it("names the missing limit rather than the ones that were provided", () => {
    const { whatsapp_messages_per_day: _omitted, ...withoutWhatsapp } = VALID;
    expect(messageFor(withoutWhatsapp)).toBe(
      "WhatsApp messages per UTC day must be a whole number between 1 and 1,000,000,000.",
    );
  });

  // Reachable from the UI: the client gate accepts any positive integer, so an operator raising a
  // cap can submit a value the schema's max rejects.
  it("names which limit is out of range", () => {
    expect(messageFor({ ...VALID, sms_segments_per_day: 2_000_000_000 })).toBe(
      "SMS segments per UTC day must be a whole number between 1 and 1,000,000,000.",
    );
  });

  it("keeps the schema's own wording for the reason", () => {
    expect(messageFor({ ...VALID, reason: "tiny" })).toBe(
      "Give a reason (at least 8 characters).",
    );
  });

  it("falls back to guidance for an unrecognised field", () => {
    expect(messageFor("not an object")).toBe(
      "Check the daily limits and the reason for change, then try again.",
    );
  });
});
