import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Fabric, WebhookVerificationError } from "./index.js";

const secret = "whsec_example";
const now = new Date("2026-07-12T12:00:00.000Z");
const timestamp = Math.floor(now.getTime() / 1000);
const payload = JSON.stringify({
  id: "evt_1",
  type: "sms.delivered",
  data: { messageId: "msg_1" },
});

function signature(body = payload, time = timestamp): string {
  const digest = createHmac("sha256", secret)
    .update(`${time}.${body}`)
    .digest("hex");
  return `t=${time},v1=${digest}`;
}

describe("webhook verification", () => {
  const webhooks = new Fabric({ apiKey: "sk_test_example" }).webhooks;

  it("verifies and parses the exact raw payload", () => {
    const event = webhooks.verify<{ messageId: string }>({
      payload,
      signature: signature(),
      secret,
      now,
    });
    expect(event).toEqual({
      id: "evt_1",
      type: "sms.delivered",
      data: { messageId: "msg_1" },
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
      }).type,
    ).toBe("future.created");
  });
});
