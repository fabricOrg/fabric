import { describe, expect, it } from "vitest";
import { publicWebhookEventType } from "./webhook-delivery.service.js";

describe("public webhook event vocabulary", () => {
  it.each([
    ["message.created", { status: "queued" }, "message.sent"],
    ["message.updated", { status: "accepted" }, "message.sent"],
    ["message.updated", { status: "sent" }, "message.sent"],
    ["message.updated", { status: "delivered" }, "message.delivered"],
    ["message.updated", { status: "undelivered" }, "message.undelivered"],
    ["message.updated", { status: "failed" }, "message.failed"],
    ["message.updated", { status: "expired" }, "message.failed"],
    ["message.received", { channel: "sms" }, "message.inbound"],
  ])("maps %s/%o to %s", (internal, payload, expected) => {
    expect(publicWebhookEventType(internal, payload)).toBe(expected);
  });

  it("does not rename unrelated domain events", () => {
    expect(publicWebhookEventType("topup.succeeded", {})).toBe(
      "topup.succeeded",
    );
  });
});
