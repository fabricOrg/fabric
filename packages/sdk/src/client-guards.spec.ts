import { afterEach, describe, expect, it, vi } from "vitest";
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

  // The endpoint override moved off `FabricConfig` and onto FABRIC_BASE_URL, so these guards now
  // protect an operator's environment rather than a caller's argument. Same rules, same messages.
  describe("FABRIC_BASE_URL", () => {
    afterEach(() => {
      delete process.env.FABRIC_BASE_URL;
    });

    function construct(value: string) {
      process.env.FABRIC_BASE_URL = value;
      return () => new Fabric({ apiKey: "sk_test_example" });
    }

    it("rejects a non-HTTPS endpoint unless it is loopback", () => {
      expect(construct("http://api.example.com")).toThrow(/HTTPS/);
      expect(construct("http://localhost")).not.toThrow();
      expect(construct("http://127.0.0.1:4010")).not.toThrow();
      expect(construct("https://private.test.internal")).not.toThrow();
    });

    it("rejects credentials, a query string and a fragment", () => {
      expect(construct("https://user:password@api.example.com")).toThrow(
        /embedded credentials/,
      );
      expect(construct("https://api.example.com?tenant=other")).toThrow(
        /query string or fragment/,
      );
      expect(construct("https://api.example.com#frag")).toThrow(
        /query string or fragment/,
      );
    });

    it("rejects a value that is not an absolute URL", () => {
      expect(construct("api.example.com")).toThrow(/absolute URL/);
    });

    // Whitespace-only is the shape a half-set shell variable takes. Treat it as unset and fall back
    // to the default endpoint rather than throwing at construction.
    it("treats a blank value as unset", () => {
      expect(construct("   ")).not.toThrow();
    });
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
