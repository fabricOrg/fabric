import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Creds } from "../plugin.js";
import { PaystackError, PaystackProvider } from "./provider.js";

const SECRET = "sk_test_example";
const CREDS: Creds = { secretKey: SECRET, publicKey: "pk_test_x" };
const provider = new PaystackProvider();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PaystackProvider.initCharge", () => {
  it("posts amount as exact minor units and returns the checkout URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          data: {
            authorization_url: "https://checkout.paystack.com/abc123",
            access_code: "ac_123",
            reference: "topup:abc",
          },
        }),
        { status: 200 },
      ),
    );

    const result = await provider.initCharge(
      {
        amountMinor: 5000n, // GHS 50.00 in pesewas
        currency: "GHS",
        email: "payer@example.com",
        reference: "topup:abc",
        callbackUrl: "https://app.fabric.dev/wallet",
      },
      CREDS,
    );

    expect(result.authorizationUrl).toBe(
      "https://checkout.paystack.com/abc123",
    );
    expect(result.providerRef).toBe("ac_123");
    const init = fetchMock.mock.calls[0]?.[1];
    if (!init) throw new Error("fetch was not called");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      email: "payer@example.com",
      amount: 5000,
      currency: "GHS",
      reference: "topup:abc",
      callback_url: "https://app.fabric.dev/wallet",
    });
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer sk_test_example",
    );
  });

  it("throws when Paystack rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: false, message: "Invalid key" }), {
        status: 401,
      }),
    );
    await expect(
      provider.initCharge(
        { amountMinor: 100n, currency: "GHS", email: "x@y.z", reference: "r" },
        CREDS,
      ),
    ).rejects.toBeInstanceOf(PaystackError);
  });
});

describe("PaystackProvider.verifyWebhook", () => {
  const rawBody = JSON.stringify({ event: "charge.success", data: {} });
  const signature = createHmac("sha512", SECRET)
    .update(rawBody, "utf8")
    .digest("hex");

  it("accepts a correctly-signed payload", () => {
    expect(
      provider.verifyWebhook(
        { headers: { "x-paystack-signature": signature }, rawBody },
        CREDS,
      ),
    ).toBe(true);
  });

  it("rejects a tampered payload / wrong signature", () => {
    expect(
      provider.verifyWebhook(
        { headers: { "x-paystack-signature": "deadbeef" }, rawBody },
        CREDS,
      ),
    ).toBe(false);
    expect(provider.verifyWebhook({ headers: {}, rawBody }, CREDS)).toBe(false);
  });
});

describe("PaystackProvider.parseEvent", () => {
  it("maps charge.success to a canonical success event with bigint minor units", () => {
    const event = provider.parseEvent({
      event: "charge.success",
      data: {
        reference: "topup:abc",
        amount: 5000,
        currency: "GHS",
        status: "success",
        id: 302961,
      },
    });
    expect(event).toMatchObject({
      type: "charge.success",
      reference: "topup:abc",
      amountMinor: 5000n,
      currency: "GHS",
      status: "success",
      providerRef: "302961",
    });
  });

  it("throws when the reference is missing", () => {
    expect(() =>
      provider.parseEvent({ event: "charge.success", data: {} }),
    ).toThrow(PaystackError);
  });

  it("supports GHS/NGN/USD and is currency-agnostic when unset", () => {
    expect(provider.supports({ currency: "GHS" })).toBe(true);
    expect(provider.supports({ currency: "eur" })).toBe(false);
    expect(provider.supports({})).toBe(true);
  });
});
