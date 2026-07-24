import { describe, expect, it } from "vitest";
import type { SenderId } from "@/lib/client/senders-api";
import { apiSnippets, buildPreflight, buildRecipientReport } from "./preflight";

const activeSender: SenderId = {
  id: "sender-1",
  senderId: "ACME",
  status: "active",
  country: "GH",
  type: "alphanumeric",
  useCase: "Order and account notifications.",
  submittedAt: "2026-07-15T00:00:00.000Z",
};

function checks(input?: {
  messageClass?: "transactional" | "promotional";
  deliveryMode?: "virtual" | "live";
  senders?: readonly SenderId[];
}) {
  return buildPreflight({
    report: buildRecipientReport("+233201234567", []),
    body: "Your order is ready.",
    encoding: "gsm7",
    segments: 1,
    senderId: "ACME",
    senders: input?.senders ?? [activeSender],
    messageClass: input?.messageClass ?? "transactional",
    deliveryMode: input?.deliveryMode ?? "live",
  });
}

describe("Send SMS preflight", () => {
  it("uses explicit classification instead of guessing from message text", () => {
    expect(checks().some((check) => check.id === "optout")).toBe(false);
    expect(
      checks({ messageClass: "promotional" }).some(
        (check) => check.id === "optout",
      ),
    ).toBe(true);
  });

  it("blocks a live send without an active destination sender", () => {
    const sender = checks({ senders: [] }).find(
      (check) => check.id === "sender",
    );
    expect(sender?.level).toBe("block");
  });

  it("allows a sandbox sender in virtual mode", () => {
    const sender = checks({ deliveryMode: "virtual", senders: [] }).find(
      (check) => check.id === "sender",
    );
    expect(sender?.level).toBe("info");
  });

  it("keeps classification in generated API examples", () => {
    const snippets = apiSnippets({
      to: ["+233201234567"],
      from: "ACME",
      body: "Offer",
      messageClass: "promotional",
    });
    expect(snippets.curl).toContain('"class": "promotional"');
    expect(snippets.node).toContain('class: "promotional"');
  });
});
