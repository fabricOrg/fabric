import { createHmac } from "node:crypto";
import { webhookEventType } from "@app/contracts";
import { describe, expect, it } from "vitest";
import {
  Fabric,
  KNOWN_WEBHOOK_EVENT_TYPES,
  WebhookVerificationError,
} from "./index.js";

const secret = "whsec_example";
const now = new Date("2026-07-12T12:00:00.000Z");
const timestamp = Math.floor(now.getTime() / 1000);
const payload = JSON.stringify({
  id: "evt_1",
  type: "message.delivered",
  data: { message_id: "msg_1", status: "delivered" },
});

function signature(body = payload, time = timestamp): string {
  const digest = createHmac("sha256", secret)
    .update(`${time}.${body}`)
    .digest("hex");
  return `t=${time},v1=${digest}`;
}

describe("webhook verification", () => {
  const webhooks = new Fabric({ apiKey: "sk_test_example" }).webhooks;

  it("matches the canonical shared event catalog", () => {
    expect(KNOWN_WEBHOOK_EVENT_TYPES).toEqual(webhookEventType.options);
  });

  it("verifies and parses the exact raw payload", () => {
    const event = webhooks.verify({
      payload,
      signature: signature(),
      secret,
      now,
    });
    expect(event).toEqual({
      id: "evt_1",
      type: "message.delivered",
      data: { messageId: "msg_1", status: "delivered" },
    });
  });

  it.each([
    ["tampered payload", `${payload} `, signature()],
    ["wrong secret", payload, signature()],
    ["stale timestamp", payload, signature(payload, timestamp - 301)],
  ])("rejects %s", (_name, body, header) => {
    const selectedSecret = _name === "wrong secret" ? "whsec_wrong" : secret;
    expect(() =>
      webhooks.verify({
        payload: body,
        signature: header,
        secret: selectedSecret,
        now,
      }),
    ).toThrow(WebhookVerificationError);
  });

  it("accepts unknown future event types", () => {
    const body = JSON.stringify({ type: "future.created", data: { value: 1 } });
    expect(
      webhooks.verify({
        payload: body,
        signature: signature(body),
        secret,
        now,
      }),
    ).toMatchObject({ type: "unknown", originalType: "future.created" });
  });

  it("maps canonical inbound event data", () => {
    const body = JSON.stringify({
      type: "message.inbound",
      data: { id: "inbound_1", channel: "sms" },
    });
    expect(
      webhooks.verify({
        payload: body,
        signature: signature(body),
        secret,
        now,
      }),
    ).toMatchObject({
      type: "message.inbound",
      data: { messageId: "inbound_1", channel: "sms" },
    });
  });

  it("rejects a signed known event whose data violates the SDK contract", () => {
    const body = JSON.stringify({
      type: "message.delivered",
      data: { status: "delivered" },
    });
    expect(() =>
      webhooks.verify({
        payload: body,
        signature: signature(body),
        secret,
        now,
      }),
    ).toThrow(WebhookVerificationError);
  });
});
