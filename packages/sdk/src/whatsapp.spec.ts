import { describe, expect, it, vi } from "vitest";
import { Fabric } from "./index.js";
import { ApiShapeError } from "./validation.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const message = {
  id: "98393ec2-2a34-4cb8-b3cc-4e25ec8b6c17",
  status: "accepted",
  to: "+233***89",
  provider: "sandbox-whatsapp",
  template_name: "order_update",
  template_language: "en",
  template_category: "utility",
  created_at: "2026-07-24T10:00:00.000Z",
  error_code: null,
} as const;

describe("whatsapp resource", () => {
  it("maps send input to the wire shape and parses the message", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(json({ ...message, request_id: "req_wa1" }, 201));
    const client = new Fabric({ apiKey: "sk_test_example", fetch });
    const response = await client.whatsapp.send(
      {
        to: "+233545227189",
        templateName: "order_update",
        templateLanguage: "en",
        templateCategory: "utility",
        variables: ["GH-4821"],
      },
      { idempotencyKey: "wa-1" },
    );
    const headers = fetch.mock.calls[0]?.[1]?.headers;
    expect(String(fetch.mock.calls[0]?.[0])).toContain("/v1/whatsapp/messages");
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      to: "+233545227189",
      template_name: "order_update",
      template_language: "en",
      template_category: "utility",
      variables: ["GH-4821"],
      currency: "GHS",
    });
    expect(headers).toBeInstanceOf(Headers);
    if (!(headers instanceof Headers)) {
      throw new Error("Expected fetch headers to be a Headers instance.");
    }
    expect(headers.get("idempotency-key")).toBe("wa-1");
    expect(response.data).toMatchObject({
      id: message.id,
      to: "+233***89",
      templateName: "order_update",
      errorCode: null,
    });
  });

  it("throws before any HTTP call when the idempotency key is missing", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new Fabric({ apiKey: "sk_test_example", fetch });
    await expect(
      client.whatsapp.send(
        {
          to: "+233545227189",
          templateName: "order_update",
          templateLanguage: "en",
          templateCategory: "utility",
        },
        { idempotencyKey: "" },
      ),
    ).rejects.toThrow(/idempotencyKey/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("throws before any HTTP call for a non-E.164 recipient", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new Fabric({ apiKey: "sk_test_example", fetch });
    await expect(
      client.whatsapp.send(
        {
          to: "not-e164",
          templateName: "order_update",
          templateLanguage: "en",
          templateCategory: "utility",
        },
        { idempotencyKey: "wa-1" },
      ),
    ).rejects.toThrow(/E.164/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("raises ApiShapeError for a malformed response", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(json({ ...message, status: "mystery" }));
    const client = new Fabric({ apiKey: "sk_test_example", fetch });
    await expect(
      client.whatsapp.send(
        {
          to: "+233545227189",
          templateName: "order_update",
          templateLanguage: "en",
          templateCategory: "utility",
        },
        { idempotencyKey: "wa-1" },
      ),
    ).rejects.toBeInstanceOf(ApiShapeError);
  });

  it("parses get responses", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(json({ message, request_id: "req_wa2" }));
    const client = new Fabric({ apiKey: "sk_test_example", fetch });
    const response = await client.whatsapp.get(message.id);
    expect(String(fetch.mock.calls[0]?.[0])).toContain(
      `/v1/whatsapp/messages/${message.id}`,
    );
    expect(response.data).toEqual({
      id: message.id,
      status: "accepted",
      to: "+233***89",
      provider: "sandbox-whatsapp",
      templateName: "order_update",
      templateLanguage: "en",
      templateCategory: "utility",
      createdAt: "2026-07-24T10:00:00.000Z",
      errorCode: null,
    });
  });

  it("parses list responses", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      json({
        messages: [message],
        next_cursor: "b3BhcXVl",
        request_id: "req_wa3",
      }),
    );
    const client = new Fabric({ apiKey: "sk_test_example", fetch });
    const response = await client.whatsapp.list({ limit: 1 });
    expect(String(fetch.mock.calls[0]?.[0])).toContain(
      "/v1/whatsapp/messages?limit=1",
    );
    expect(response.data.nextCursor).toBe("b3BhcXVl");
    expect(response.data.items).toHaveLength(1);
    expect(response.data.items[0]?.to).toBe("+233***89");
  });

  it("accepts a masked response recipient", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(json({ ...message, to: "+233***89" }));
    const client = new Fabric({ apiKey: "sk_test_example", fetch });
    await expect(
      client.whatsapp.send(
        {
          to: "+233545227189",
          templateName: "order_update",
          templateLanguage: "en",
          templateCategory: "utility",
        },
        { idempotencyKey: "wa-1" },
      ),
    ).resolves.toMatchObject({ data: { to: "+233***89" } });
  });
});
