import { describe, expect, it, vi } from "vitest";
import { Fabric, ValidationError } from "./index.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const wireSender = {
  id: "snd_1",
  sender_id: "FABRIC",
  country: "GH",
  type: "alphanumeric",
  use_case: "Order updates",
  status: "pending",
  rejection_reason: null,
  created_at: "2026-07-24T10:00:00.000Z",
};

describe("sender IDs resource", () => {
  it("maps create input to the wire shape with the alphanumeric default", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(json({ ...wireSender, request_id: "req_s1" }, 201));
    const client = new Fabric({ apiKey: "sk_test_example", fetch });
    const response = await client.senderIds.create(
      { senderId: "FABRIC", country: "GH", useCase: "Order updates" },
      { idempotencyKey: "sender-1" },
    );
    expect(String(fetch.mock.calls[0]?.[0])).toContain("/v1/senders");
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      sender_id: "FABRIC",
      country: "GH",
      type: "alphanumeric",
      use_case: "Order updates",
    });
    expect(response.data).toEqual({
      id: "snd_1",
      senderId: "FABRIC",
      country: "GH",
      type: "alphanumeric",
      useCase: "Order updates",
      status: "pending",
      rejectionReason: null,
      createdAt: "2026-07-24T10:00:00.000Z",
    });
  });

  it("rejects blank fields before any network call", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new Fabric({ apiKey: "sk_test_example", fetch });
    await expect(
      client.senderIds.create({ senderId: " ", country: "GH", useCase: "x" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      client.senderIds.create({
        senderId: "FABRIC",
        country: "NG",
        useCase: "",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
