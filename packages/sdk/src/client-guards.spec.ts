import { describe, expect, it, vi } from "vitest";
import { Fabric, InsufficientFundsError } from "./index.js";

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

describe("client guards", () => {
  it("refuses to construct in a browser-like runtime", () => {
    vi.stubGlobal("window", { document: {} });
    try {
      expect(() => new Fabric({ apiKey: "sk_test_example" })).toThrow(
        /trusted server environment/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects a non-HTTPS baseUrl unless it is loopback", () => {
    expect(
      () =>
        new Fabric({
          apiKey: "sk_test_example",
          baseUrl: "http://api.example.com",
        }),
    ).toThrow(/HTTPS/);
    expect(
      () =>
        new Fabric({ apiKey: "sk_test_example", baseUrl: "http://localhost" }),
    ).not.toThrow();
    expect(
      () =>
        new Fabric({
          apiKey: "sk_test_example",
          baseUrl: "http://127.0.0.1:4010",
        }),
    ).not.toThrow();
    expect(
      () =>
        new Fabric({
          apiKey: "sk_test_example",
          baseUrl: "https://private.test.internal",
        }),
    ).not.toThrow();
  });

  it("rejects invalid retry and timeout configuration", () => {
    expect(
      () => new Fabric({ apiKey: "sk_test_example", maxRetries: -1 }),
    ).toThrow(/maxRetries/);
    expect(
      () => new Fabric({ apiKey: "sk_test_example", maxRetries: 1.5 }),
    ).toThrow(/maxRetries/);
    expect(() => new Fabric({ apiKey: "sk_test_example", timeout: 0 })).toThrow(
      /timeout/,
    );
    expect(
      () => new Fabric({ apiKey: "sk_test_example", timeout: Number.NaN }),
    ).toThrow(/timeout/);
  });

  it("maps a 402 to InsufficientFundsError with the server's stable code", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      json(
        {
          error: {
            code: "insufficient_funds",
            message: "The wallet could not reserve the message cost.",
          },
          request_id: "req_402",
        },
        402,
      ),
    );
    const rejection = expect(
      new Fabric({ apiKey: "sk_test_example", fetch }).sms.send(
        { to: "+233545227189", senderId: "Fabric", body: "Hello" },
        { idempotencyKey: "order-1" },
      ),
    ).rejects;
    await rejection.toBeInstanceOf(InsufficientFundsError);
    await rejection.toMatchObject({
      code: "insufficient_funds",
      statusCode: 402,
      requestId: "req_402",
      retryable: false,
    });
  });
});
