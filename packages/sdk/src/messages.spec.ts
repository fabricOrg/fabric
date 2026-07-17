import { describe, expect, it, vi } from "vitest";
import { MessagesResource } from "./messages.js";
import { Transport } from "./transport.js";

describe("MessagesResource", () => {
  it("forwards locale and recipient eligibility inputs", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          version_id: "2ccb4b9f-384e-4f4e-8983-ff12555223d0",
          environment: "sandbox",
          resolved_locale: "fr",
          blockers: [],
          warnings: [],
          eligible: true,
          sender: { sender_id: "FABRIC", status: "sandbox" },
          message_class: "transactional",
          preview: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const transport = new Transport({
      apiKey: "sk_test_example",
      baseUrl: "https://api.example.test",
      timeout: 1_000,
      maxRetries: 0,
      fetch,
      sdkVersion: "0.0.0-test",
    });
    const resource = new MessagesResource(transport);

    await resource.preview("order.shipped", {
      locale: "fr",
      to: "+233201234567",
      data: { name: "Ada" },
    });

    const request = fetch.mock.calls[0]?.[1];
    expect(request?.body).toBe(
      JSON.stringify({
        key: "order.shipped",
        data: { name: "Ada" },
        to: "+233201234567",
        locale: "fr",
      }),
    );
  });
});
