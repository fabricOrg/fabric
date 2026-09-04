import { describe, expect, it, vi } from "vitest";
import { Fabric } from "./index.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("sms retrieval", () => {
  it("parses a full message detail with its delivery timeline", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      json({
        message: {
          id: "msg_1",
          status: "delivered",
          encoding: "gsm7",
          segments: 1,
          cost: { minor: "3", currency: "GHS" },
          to: "+233545227189",
          provider: "sandbox",
          backing: "sandbox_allowance",
          delivery_mode: "virtual",
          created_at: "2026-07-24T10:00:00.000Z",
          sender_id: "FABRIC",
          redacted: false,
          body: "Hi Ama, your order GH-4821 has shipped.",
          timeline: [
            { status: "queued", at: "2026-07-24T10:00:00.000Z" },
            { status: "sent", at: "2026-07-24T10:00:01.000Z" },
            {
              status: "delivered",
              at: "2026-07-24T10:00:02.000Z",
              note: "virtual delivery",
            },
          ],
        },
        request_id: "req_m1",
      }),
    );
    const client = new Fabric({ apiKey: "sk_test_example", fetch });
    const response = await client.sms.retrieve("msg_1");
    expect(String(fetch.mock.calls[0]?.[0])).toContain("/v1/sms/msg_1");
    expect(response.data).toMatchObject({
      id: "msg_1",
      status: "delivered",
      deliveryMode: "virtual",
      senderId: "FABRIC",
      redacted: false,
      body: "Hi Ama, your order GH-4821 has shipped.",
    });
    expect(response.data.timeline).toHaveLength(3);
    expect(response.data.timeline[2]).toEqual({
      status: "delivered",
      at: "2026-07-24T10:00:02.000Z",
      note: "virtual delivery",
    });
  });

  it("rejects a detail payload missing contract fields", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      json({
        message: { id: "msg_1", status: "delivered" },
        request_id: "req_m2",
      }),
    );
    const client = new Fabric({ apiKey: "sk_test_example", fetch });
    await expect(client.sms.retrieve("msg_1")).rejects.toThrow(
      /does not match the SDK contract/,
    );
  });
});
