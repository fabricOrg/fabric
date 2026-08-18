import { describe, expect, it } from "vitest";
import {
  isTerminalMessageStatus,
  type MessageStatus,
  messageStatus,
  messageStatusGroupOf,
  TERMINAL_MESSAGE_STATUSES,
} from "./message-status.js";

describe("messageStatus", () => {
  it("accepts every canonical F5.3 status", () => {
    const all: MessageStatus[] = [
      "queued",
      "sending",
      "accepted",
      "sent",
      "delivered",
      "undelivered",
      "failed",
      "expired",
    ];
    for (const s of all) {
      expect(messageStatus.parse(s)).toBe(s);
    }
    expect(messageStatus.options).toHaveLength(8);
  });

  it("rejects a non-canonical status (guards providers against inventing values)", () => {
    expect(messageStatus.safeParse("rejected").success).toBe(false);
    expect(messageStatus.safeParse("received").success).toBe(false);
    expect(messageStatus.safeParse("").success).toBe(false);
  });
});

describe("message status groups", () => {
  it("keeps every unsuccessful terminal state out of in-progress activity", () => {
    expect(messageStatusGroupOf("queued")).toBe("active");
    expect(messageStatusGroupOf("accepted")).toBe("active");
    expect(messageStatusGroupOf("delivered")).toBe("delivered");
    expect(messageStatusGroupOf("undelivered")).toBe("failed");
    expect(messageStatusGroupOf("failed")).toBe("failed");
    expect(messageStatusGroupOf("expired")).toBe("failed");
  });
});

describe("terminal statuses", () => {
  it("terminal set is exactly {delivered, undelivered, failed, expired}", () => {
    expect([...TERMINAL_MESSAGE_STATUSES].sort()).toEqual(
      ["delivered", "expired", "failed", "undelivered"].sort(),
    );
  });

  it("isTerminalMessageStatus discriminates terminal from in-flight", () => {
    expect(isTerminalMessageStatus("delivered")).toBe(true);
    expect(isTerminalMessageStatus("expired")).toBe(true);
    expect(isTerminalMessageStatus("accepted")).toBe(false);
    expect(isTerminalMessageStatus("queued")).toBe(false);
  });
});
