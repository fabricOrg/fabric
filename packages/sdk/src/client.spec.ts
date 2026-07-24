import { describe, expect, it, vi } from "vitest";
import {
  type AuthenticationError,
  Fabric,
  type FabricEnvironment,
  type IdempotentWriteOptions,
  type RateLimitError,
  type RequestOptions,
  ValidationError,
  type WriteOptions,
} from "./index.js";

const requestOptions: RequestOptions = { timeout: 1_000 };
// @ts-expect-error The public environment vocabulary is sandbox/live only.
const invalidEnvironment: FabricEnvironment = "production";
const writeOptions: WriteOptions = { idempotencyKey: "optional-for-direct" };
const idempotentOptions: IdempotentWriteOptions = {
  idempotencyKey: "required-for-managed",
};
// @ts-expect-error Read options cannot silently enable write retry semantics.
const invalidRequestOptions: RequestOptions = { idempotencyKey: "wrong" };
// @ts-expect-error Durable managed writes require a caller idempotency key.
const invalidIdempotentOptions: IdempotentWriteOptions = {};

void [
  requestOptions,
  writeOptions,
  idempotentOptions,
  invalidRequestOptions,
  invalidIdempotentOptions,
  invalidEnvironment,
];

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("Fabric client", () => {
  it("detects key environment and rejects ambiguous keys", () => {
    expect(new Fabric({ apiKey: "sk_test_example" }).environment).toBe(
      "sandbox",
    );
    expect(new Fabric({ apiKey: "sk_live_example" }).environment).toBe("live");
    expect(() => new Fabric({ apiKey: "secret" })).toThrow(/sk_test_/);
  });

  it("validates SMS input before the network call", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new Fabric({ apiKey: "sk_test_example", fetch });
    await expect(
      client.sms.send({ to: "0244", senderId: "Fabric", body: "Hello" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses the deployed Fabric API without consumer endpoint configuration", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        json({ messages: [], next_cursor: null, request_id: "req_default" }),
      );
    await new Fabric({ apiKey: "sk_test_example", fetch }).sms.list();
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "https://d2umm5b2x22zvp.cloudfront.net/v1/messages",
    );
  });

  it("maps SMS input, authentication, idempotency, and response metadata", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      json(
        {
          id: "msg_1",
          status: "accepted",
          encoding: "gsm7",
          segments: 1,
          cost: { minor: "5", currency: "GHS" },
          request_id: "req_1",
        },
        201,
      ),
    );
    const client = new Fabric({ apiKey: "sk_test_example", fetch });
    const response = await client.sms.send(
      { to: "+233545227189", senderId: "Fabric", body: "Hello" },
      { idempotencyKey: "order-1" },
    );
    const request = fetch.mock.calls[0]?.[1];
    const headers = new Headers(request?.headers);
    expect(headers.get("authorization")).toBe("Bearer sk_test_example");
    expect(headers.get("idempotency-key")).toBe("order-1");
    expect(JSON.parse(String(request?.body))).toMatchObject({
      sender_id: "Fabric",
      currency: "GHS",
    });
    expect(response).toMatchObject({
      requestId: "req_1",
      retryCount: 0,
      data: { id: "msg_1" },
    });
  });

  it("maps API authentication and rate-limit errors", async () => {
    const authFetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      json(
        {
          error: {
            code: "invalid_api_key",
            message: "The API key is invalid.",
          },
          request_id: "req_auth",
        },
        401,
      ),
    );
    await expect(
      new Fabric({ apiKey: "sk_test_example", fetch: authFetch }).sms.list(),
    ).rejects.toMatchObject({
      code: "invalid_api_key",
      requestId: "req_auth",
      statusCode: 401,
    } satisfies Partial<AuthenticationError>);
    const rateFetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      json({ error: { code: "rate_limited", message: "Slow down." } }, 429, {
        "retry-after": "5",
      }),
    );
    await expect(
      new Fabric({
        apiKey: "sk_test_example",
        fetch: rateFetch,
        maxRetries: 0,
      }).sms.list(),
    ).rejects.toMatchObject({
      retryAfter: 5,
      retryable: true,
    } satisfies Partial<RateLimitError>);
  });

  it("does not retry an unprotected write", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        json({ error: { code: "upstream", message: "Unavailable" } }, 503),
      );
    const client = new Fabric({
      apiKey: "sk_test_example",
      fetch,
      maxRetries: 2,
    });
    await expect(
      client.sms.send({
        to: "+233545227189",
        senderId: "Fabric",
        body: "Hello",
      }),
    ).rejects.toThrow("Unavailable");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries transient reads and idempotency-protected writes", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        json({ error: { code: "upstream", message: "Unavailable" } }, 503),
      )
      .mockResolvedValueOnce(
        json({ messages: [], next_cursor: null, request_id: "req_ok" }),
      );
    const client = new Fabric({
      apiKey: "sk_test_example",
      fetch,
      maxRetries: 1,
    });
    const response = await client.sms.list();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(response.retryCount).toBe(1);
  });

  it("isolates requests from logger failures", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        json({ messages: [], next_cursor: null, request_id: "req_logger" }),
      );
    const client = new Fabric({
      apiKey: "sk_test_example",
      fetch,
      logger: {
        debug: () => {
          throw new Error("logger unavailable");
        },
      },
    });
    await expect(client.sms.list()).resolves.toMatchObject({
      requestId: "req_logger",
    });
  });

  it("parses an HTTP-date Retry-After header", async () => {
    const retryAt = new Date(Date.now() + 4_000).toUTCString();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      json({ error: { code: "rate_limited", message: "Slow down." } }, 429, {
        "retry-after": retryAt,
      }),
    );
    const request = new Fabric({
      apiKey: "sk_test_example",
      fetch,
      maxRetries: 0,
    }).sms.list();
    await expect(request).rejects.toMatchObject({
      retryAfter: expect.any(Number),
    });
  });
});
