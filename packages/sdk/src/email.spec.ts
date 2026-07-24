import { describe, expect, it, vi } from "vitest";
import { Fabric, ValidationError } from "./index.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("email resource", () => {
  it("maps send input to the wire shape and parses the acceptance", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        json({ id: "eml_1", status: "queued", request_id: "req_e1" }, 201),
      );
    const client = new Fabric({ apiKey: "sk_test_example", fetch });
    const response = await client.email.send(
      {
        to: "ama@example.com",
        from: "hello@merchant.example",
        subject: "Welcome",
        text: "Hi Ama",
        replyTo: "support@merchant.example",
      },
      { idempotencyKey: "welcome-1" },
    );
    expect(String(fetch.mock.calls[0]?.[0])).toContain("/v1/email/messages");
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      to: "ama@example.com",
      from: "hello@merchant.example",
      subject: "Welcome",
      text: "Hi Ama",
      reply_to: "support@merchant.example",
    });
    expect(response.data).toEqual({ id: "eml_1", status: "queued" });
    expect(response.requestId).toBe("req_e1");
  });

  it("rejects invalid input before any network call", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new Fabric({ apiKey: "sk_test_example", fetch });
    await expect(
      client.email.send({
        to: "not-an-address",
        from: "hello@merchant.example",
        subject: "Welcome",
        text: "Hi",
      }),
    ).rejects.toThrow(/email address/);
    await expect(
      client.email.send({
        to: "ama@example.com",
        from: "hello@merchant.example",
        subject: "  ",
        text: "Hi",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      client.email.send({
        to: "ama@example.com",
        from: "hello@merchant.example",
        subject: "Welcome",
      }),
    ).rejects.toThrow(/`text` or `html`/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("parses the snake_case list payload into typed messages", async () => {
    const message = {
      id: "eml_1",
      status: "delivered",
      to: "ama@example.com",
      from: "hello@merchant.example",
      subject: "Welcome",
      provider: "sandbox",
      created_at: "2026-07-24T10:00:00.000Z",
      error_code: null,
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(json({ messages: [message], request_id: "req_e2" }));
    const client = new Fabric({ apiKey: "sk_test_example", fetch });
    const response = await client.email.list();
    expect(response.data).toEqual([
      {
        id: "eml_1",
        status: "delivered",
        to: "ama@example.com",
        from: "hello@merchant.example",
        subject: "Welcome",
        provider: "sandbox",
        createdAt: "2026-07-24T10:00:00.000Z",
        errorCode: null,
      },
    ]);
  });

  it("rejects a list payload that does not match the contract", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(json({ messages: "nope", request_id: "req_e3" }));
    const client = new Fabric({ apiKey: "sk_test_example", fetch });
    await expect(client.email.list()).rejects.toThrow(/messages/);
  });
});
