import { describe, expect, it } from "vitest";
import { parseInboundMessages, toE164 } from "./whatsapp-inbound-parse.js";

const NOW = new Date("2026-08-09T12:00:00.000Z");

function payload(messages: unknown[], phoneNumberId = "555000111") {
  return {
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: phoneNumberId },
              messages,
            },
          },
        ],
      },
    ],
  };
}

describe("parseInboundMessages (ADR-0015)", () => {
  it("extracts a text message with Meta's second-precision timestamp", () => {
    const [message] = parseInboundMessages(
      payload([
        {
          id: "wamid.abc",
          from: "233545227189",
          timestamp: "1786320000",
          type: "text",
          text: { body: "hello" },
        },
      ]),
      NOW,
    );
    expect(message).toMatchObject({
      providerRef: "wamid.abc",
      from: "233545227189",
      type: "text",
      phoneNumberId: "555000111",
      receivedAt: new Date(1_786_320_000 * 1000),
    });
    // The raw object is kept verbatim — it is the content, and it goes to the vault, not to columns.
    expect(message?.raw).toMatchObject({ text: { body: "hello" } });
  });

  it("keeps a message type it does not model", () => {
    // Meta adds types. An unmodelled one is still a real customer in a real conversation, and
    // dropping it would lose the message AND fail to extend the service window.
    const [message] = parseInboundMessages(
      payload([{ id: "wamid.img", from: "233545227189", type: "sticker" }]),
      NOW,
    );
    expect(message?.type).toBe("sticker");
  });

  it("falls back to arrival time rather than epoch zero", () => {
    const [missing] = parseInboundMessages(
      payload([{ id: "wamid.a", from: "233545227189", type: "text" }]),
      NOW,
    );
    const [garbage] = parseInboundMessages(
      payload([
        {
          id: "wamid.b",
          from: "233545227189",
          timestamp: "not-a-number",
          type: "text",
        },
      ]),
      NOW,
    );
    expect(missing?.receivedAt).toEqual(NOW);
    expect(garbage?.receivedAt).toEqual(NOW);
  });

  it("defaults an absent type rather than dropping the message", () => {
    const [message] = parseInboundMessages(
      payload([{ id: "wamid.c", from: "233545227189" }]),
      NOW,
    );
    expect(message?.type).toBe("unknown");
  });

  it("skips a change with no phone_number_id — nothing to attribute against", () => {
    const noMetadata = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ id: "wamid.d", from: "233545227189" }],
              },
            },
          ],
        },
      ],
    };
    expect(parseInboundMessages(noMetadata, NOW)).toEqual([]);
  });

  it("returns nothing for a statuses-only payload", () => {
    // Meta multiplexes delivery statuses, template events and inbound onto one endpoint, so an empty
    // result is the normal case, never an error.
    const statuses = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "555000111" },
                statuses: [{ id: "wamid.e", status: "delivered" }],
              },
            },
          ],
        },
      ],
    };
    expect(parseInboundMessages(statuses, NOW)).toEqual([]);
    expect(parseInboundMessages({ nonsense: true }, NOW)).toEqual([]);
  });

  it("skips a message with no id — there would be no idempotency key", () => {
    expect(
      parseInboundMessages(payload([{ from: "233545227189" }]), NOW),
    ).toEqual([]);
  });

  it("adds the leading + Meta omits", () => {
    expect(toE164("233545227189")).toBe("+233545227189");
    expect(toE164("+233545227189")).toBe("+233545227189");
  });
});
