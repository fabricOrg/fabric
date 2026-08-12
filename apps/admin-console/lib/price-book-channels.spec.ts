import { messageChannel } from "@app/contracts";
import { describe, expect, it } from "vitest";
import { visibleChannels } from "./price-book-channels.js";

describe("visibleChannels", () => {
  // The regression: the grid listed its rows as a hardcoded ["sms", "email"], so a WhatsApp rate
  // that HAD been saved rendered as no row at all and read as "the price did not save".
  it("shows a WhatsApp row when the book prices WhatsApp", () => {
    expect(
      visibleChannels([
        { channel: "sms" },
        { channel: "whatsapp" },
        { channel: "email" },
      ]),
    ).toEqual(["sms", "email", "whatsapp"]);
  });

  it("shows only the channels the book actually prices", () => {
    expect(visibleChannels([{ channel: "whatsapp" }])).toEqual(["whatsapp"]);
    expect(visibleChannels([])).toEqual([]);
  });

  // Guards the fix rather than the symptom: adding a channel to the contract must not need an edit
  // here, which is exactly the coupling the hardcoded literal broke.
  it("can show every channel the contract defines", () => {
    const all = messageChannel.options.map((channel) => ({ channel }));
    expect(visibleChannels(all)).toEqual([...messageChannel.options]);
  });
});
