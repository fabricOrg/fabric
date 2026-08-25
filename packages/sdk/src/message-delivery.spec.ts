import { describe, expect, it } from "vitest";
import { parseMessageDelivery } from "./message-delivery.js";
import { ApiShapeError } from "./validation.js";

/**
 * A WhatsApp managed delivery used to THROW here, not mistype.
 *
 * `parseMessageDelivery` validated `channel` against `["sms", "email"]`, and `enumField` throws
 * `ApiShapeError` on anything else — while the API publishes `["sms", "email", "whatsapp"]` and
 * `messages.ts` already accepted all three. So the SDK rejected a response the API is documented to
 * return, and the failure surfaced as an exception inside the client rather than as a type error at
 * compile time, which is the worst of both.
 */

const WHATSAPP_DELIVERY: Record<string, unknown> = {
  id: "md_1",
  key: "order.shipped",
  version_id: "ver_1",
  environment: "live",
  locale: "en",
  channel: "whatsapp",
  status: "delivered",
  resource_version: 1,
  recipient: "+233200000000",
  reference: null,
  metadata: {},
  cost: { currency: "GHS", minor: "300" },
  created_at: "2026-08-25T00:00:00.000Z",
  updated_at: "2026-08-25T00:00:00.000Z",
  attempts: [
    {
      id: "att_1",
      ordinal: 1,
      channel: "whatsapp",
      message_id: "msg_1",
      status: "delivered",
      cost: { currency: "GHS", minor: "300" },
      error_code: null,
      created_at: "2026-08-25T00:00:00.000Z",
      updated_at: "2026-08-25T00:00:00.000Z",
    },
  ],
};

describe("parseMessageDelivery", () => {
  it("accepts a WhatsApp delivery, on the resource and on its attempts", () => {
    const parsed = parseMessageDelivery(WHATSAPP_DELIVERY);
    expect(parsed.channel).toBe("whatsapp");
    expect(parsed.attempts[0]?.channel).toBe("whatsapp");
  });

  it("still rejects a channel the API cannot return", () => {
    // Asserted on the TYPE and the field, not a bare `toThrow()` — which would keep passing if the
    // fixture rotted and the throw came from one of the fields parsed BEFORE channel (`attempts`,
    // `id`, `key`, `version_id`, `environment`, `locale`) rather than from the channel itself.
    expect(() =>
      parseMessageDelivery({ ...WHATSAPP_DELIVERY, channel: "carrier-pigeon" }),
    ).toThrow(ApiShapeError);
    expect(() =>
      parseMessageDelivery({ ...WHATSAPP_DELIVERY, channel: "carrier-pigeon" }),
    ).toThrow(/channel/);
  });
});
