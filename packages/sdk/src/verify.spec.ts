import { describe, expect, it, vi } from "vitest";
import { Fabric } from "./index.js";

const STARTED = {
  id: "2ccb4b9f-384e-4f4e-8983-ff12555223d0",
  status: "pending",
  to: "+23354•••7189",
  channel: "sms",
  expires_in: 300,
  expires_at: "2026-09-06T07:05:00.000Z",
} as const;

function clientCapturingBody(): {
  client: Fabric;
  body: () => Record<string, unknown>;
} {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response(JSON.stringify(STARTED), {
      status: 201,
      headers: { "content-type": "application/json" },
    }),
  );
  return {
    client: new Fabric({ apiKey: "sk_test_verify", fetch }),
    body: () => JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)),
  };
}

describe("verify start request body", () => {
  // The template surface is only reachable through what the SDK puts on the wire, and a dropped
  // field fails SILENTLY: the API renders its built-in wording and answers 201, so a caller who
  // asked for their own branding gets "Fabric" and no error to explain it.
  it("sends the template selection through untouched", async () => {
    const { client, body } = clientCapturingBody();
    await client.verify.start({
      to: "+233545227189",
      senderId: "MERCHANT",
      template: "merchant.otp",
      // Template variable names belong to the author, so they must survive verbatim rather than
      // being camelCased into names no template declares.
      variables: { merchant_name: "Jasper's Market", order_count: 3 },
      locale: "fr-FR",
    });
    expect(body()).toEqual({
      to: "+233545227189",
      sender_id: "MERCHANT",
      template: "merchant.otp",
      variables: { merchant_name: "Jasper's Market", order_count: 3 },
      locale: "fr-FR",
    });
  });

  it("omits the template fields entirely when they are not supplied", async () => {
    const { client, body } = clientCapturingBody();
    await client.verify.start({ to: "+233545227189" });
    // The request contract is strict (additionalProperties: false) and treats an absent template as
    // "use the built-in wording" — a null or an empty string is not the same request.
    expect(body()).toEqual({ to: "+233545227189" });
  });
});
