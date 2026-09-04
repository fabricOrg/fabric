import { describe, expect, it, vi } from "vitest";
import { Fabric } from "./index.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const wireEndpoint = {
  id: "whe_1",
  url: "https://merchant.example/webhooks/fabric",
  status: "active",
  description: null,
  env: "sandbox",
  secret_prefix: "whsec_on",
  created_at: "2026-07-24T10:00:00.000Z",
  health: { pending: 0, dead: 0, last_delivered_at: null },
};

describe("webhook endpoint management", () => {
  it("creates an endpoint and surfaces the one-time secret", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      json(
        {
          ...wireEndpoint,
          secret: "whsec_once",
          request_id: "req_w1",
        },
        201,
      ),
    );
    const client = new Fabric({ apiKey: "sk_test_example", fetch });
    const response = await client.webhooks.create({
      url: "https://merchant.example/webhooks/fabric",
    });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      url: "https://merchant.example/webhooks/fabric",
    });
    expect(response.data.secret).toBe("whsec_once");
    expect(response.data.status).toBe("active");
  });

  it("remove and disable issue the same soft-delete call", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const client = new Fabric({ apiKey: "sk_test_example", fetch });
    await client.webhooks.remove("whe_1");
    await client.webhooks.disable("whe_1");
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const call of fetch.mock.calls) {
      expect(String(call[0])).toContain("/v1/webhooks/whe_1");
      expect(call[1]?.method).toBe("DELETE");
    }
  });
});
