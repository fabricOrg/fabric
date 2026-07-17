import { sendManagedMessageResponse } from "@app/contracts";
import { describe, expect, it, vi } from "vitest";
import { ValidationError } from "./errors.js";
import { MessagesResource } from "./messages.js";
import { Transport } from "./transport.js";

const canonicalDelivery = {
  id: "5eb63bbb-e01e-4eed-8b45-1c2f4200ad2c",
  key: "order.shipped",
  version_id: "2ccb4b9f-384e-4f4e-8983-ff12555223d0",
  environment: "sandbox",
  locale: "en",
  channel: "sms",
  status: "delivered",
  resource_version: 2,
  recipient: "+233200000042",
  reference: "order-42",
  metadata: { source: "spec" },
  cost: { minor: "3", currency: "GHS" },
  attempts: [
    {
      id: "98393ec2-2a34-4cb8-b3cc-4e25ec8b6c17",
      ordinal: 1,
      channel: "sms",
      message_id: "5a344e61-16c4-4e07-924f-fabdfb81fa14",
      status: "delivered",
      cost: { minor: "3", currency: "GHS" },
      error_code: null,
      created_at: "2026-07-17T12:00:00.000Z",
      updated_at: "2026-07-17T12:00:01.000Z",
    },
  ],
  created_at: "2026-07-17T12:00:00.000Z",
  updated_at: "2026-07-17T12:00:01.000Z",
};

function resourceReturning(payload: unknown, status = 200) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  const transport = new Transport({
    apiKey: "sk_test_example",
    baseUrl: "https://api.example.test",
    timeout: 1_000,
    maxRetries: 0,
    fetch,
    sdkVersion: "0.0.0-test",
  });
  return { resource: new MessagesResource(transport), fetch };
}

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

  it("sends by key with the idempotency header and maps the canonical delivery", async () => {
    // Round-tripping through the canonical contract keeps the SDK's parser honest.
    const payload = sendManagedMessageResponse.parse({
      delivery: canonicalDelivery,
      request_id: "req_send",
    });
    const { resource, fetch } = resourceReturning(payload, 202);

    const result = await resource.send("order.shipped", {
      to: "+233200000042",
      data: { name: "Ada", count: 2 },
      reference: "order-42",
      metadata: { source: "spec" },
      maxCost: { minor: "500", currency: "GHS" },
      idempotencyKey: "send-001",
    });

    const request = fetch.mock.calls[0]?.[1];
    expect(new Headers(request?.headers).get("idempotency-key")).toBe(
      "send-001",
    );
    expect(request?.body).toBe(
      JSON.stringify({
        key: "order.shipped",
        to: "+233200000042",
        data: { name: "Ada", count: 2 },
        reference: "order-42",
        metadata: { source: "spec" },
        limits: { max_cost: { minor: "500", currency: "GHS" } },
      }),
    );
    expect(result.data).toMatchObject({
      id: canonicalDelivery.id,
      key: "order.shipped",
      versionId: canonicalDelivery.version_id,
      environment: "sandbox",
      status: "delivered",
      resourceVersion: 2,
      recipient: "+233200000042",
      reference: "order-42",
      metadata: { source: "spec" },
      cost: { minor: "3", currency: "GHS" },
      attempts: [
        {
          ordinal: 1,
          messageId: "5a344e61-16c4-4e07-924f-fabdfb81fa14",
          status: "delivered",
          errorCode: null,
        },
      ],
    });
  });

  it("requires an idempotency key and a valid recipient before any request", async () => {
    const { resource, fetch } = resourceReturning({});
    await expect(
      resource.send("order.shipped", { to: "not-e164", idempotencyKey: "k" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      resource.send("order.shipped", {
        to: "+233200000042",
        idempotencyKey: "",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retrieves a delivery by id", async () => {
    const { resource, fetch } = resourceReturning({
      delivery: canonicalDelivery,
      request_id: "req_get",
    });
    const result = await resource.retrieveDelivery(canonicalDelivery.id);
    expect(String(fetch.mock.calls[0]?.[0])).toContain(
      `/v1/message-deliveries/${canonicalDelivery.id}`,
    );
    expect(result.data.attempts).toHaveLength(1);
    expect(result.data.status).toBe("delivered");
  });
});
