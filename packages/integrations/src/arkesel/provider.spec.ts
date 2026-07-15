import { afterEach, describe, expect, it, vi } from "vitest";
import type { Creds, NormalizedMessage } from "../plugin.js";
import { ArkeselError, ArkeselSmsProvider } from "./provider.js";

const CREDS: Creds = {
  apiKey: "test-api-key",
  callbackUrl: "https://api.fabric.dev/webhooks/dlr/arkesel-sms",
};
const provider = new ArkeselSmsProvider();

const MSG: NormalizedMessage = {
  messageId: "11111111-1111-1111-1111-111111111111",
  to: "+233544927189",
  senderId: "TENANTBRAND",
  body: "Hello from Fabric",
  encoding: "gsm7",
  segments: 1,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ArkeselSmsProvider.send", () => {
  it("posts the api-key header, digits-only recipient, and defaults to sandbox", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          data: [{ recipient: "233544927189", id: "abcd1234efgh5678" }],
        }),
        { status: 200 },
      ),
    );

    const result = await provider.send(MSG, CREDS);

    expect(result.status).toBe("accepted");
    expect(result.providerRef).toBe("abcd1234efgh5678");
    const init = fetchMock.mock.calls[0]?.[1];
    if (!init) throw new Error("fetch was not called");
    expect((init.headers as Record<string, string>)["api-key"]).toBe(
      "test-api-key",
    );
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      sender: "TENANTBRAND",
      message: "Hello from Fabric",
      recipients: ["233544927189"], // '+' stripped
      sandbox: true, // SAFE DEFAULT — no live delivery unless explicitly disabled
      callback_url: "https://api.fabric.dev/webhooks/dlr/arkesel-sms",
    });
  });

  it("only sends live when sandbox is explicitly 'false'", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "success", data: [{ id: "x" }] }), {
        status: 200,
      }),
    );
    await provider.send(MSG, { ...CREDS, sandbox: "false" });
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.sandbox).toBe(false);
  });

  it("returns failed on a clean provider refusal (402 insufficient balance)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ status: "error", message: "Insufficient balance" }),
        { status: 402 },
      ),
    );
    const result = await provider.send(MSG, CREDS);
    expect(result.status).toBe("failed");
  });

  it("throws on auth failure (401) so the send is retried, not swallowed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "error", message: "bad key" }), {
        status: 401,
      }),
    );
    await expect(provider.send(MSG, CREDS)).rejects.toBeInstanceOf(
      ArkeselError,
    );
  });

  it("throws (transport fault) when fetch itself rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNRESET"));
    await expect(provider.send(MSG, CREDS)).rejects.toBeInstanceOf(
      ArkeselError,
    );
  });

  it("requires the master apiKey and a valid per-message senderId", async () => {
    await expect(provider.send(MSG, {})).rejects.toThrow(ArkeselError);
    await expect(
      provider.send({ ...MSG, senderId: "" }, { apiKey: "k" }),
    ).rejects.toThrow(ArkeselError);
    await expect(
      provider.send({ ...MSG, senderId: "TOO-LONG-BRAND" }, { apiKey: "k" }),
    ).rejects.toThrow(ArkeselError);
  });
});

describe("ArkeselSmsProvider.parseDlr", () => {
  it("maps every Arkesel status to the canonical vocabulary", () => {
    const cases: Record<string, string> = {
      DELIVERED: "delivered",
      SENT: "sent",
      SUBMITTED: "sent",
      QUEUED: "queued",
      DEFERRED: "sending",
      NOT_DELIVERED: "undelivered",
      EXPIRED: "expired",
      PROHIBITED: "failed",
      REJECTED: "failed",
    };
    for (const [arkesel, canonical] of Object.entries(cases)) {
      const dlr = provider.parseDlr({ sms_id: "ref-1", status: arkesel });
      expect(dlr).toMatchObject({ providerRef: "ref-1", status: canonical });
    }
  });

  it("is case-insensitive on the status", () => {
    expect(provider.parseDlr({ sms_id: "r", status: "delivered" }).status).toBe(
      "delivered",
    );
  });

  it("throws on an unmapped status or a missing sms_id", () => {
    expect(() => provider.parseDlr({ sms_id: "r", status: "WAT" })).toThrow(
      ArkeselError,
    );
    expect(() => provider.parseDlr({ status: "DELIVERED" })).toThrow(
      ArkeselError,
    );
  });
});

describe("ArkeselSmsProvider misc", () => {
  it("supports Ghana/Nigeria and is permissive when country is unset", () => {
    expect(provider.supports({ destinationCountry: "GH" })).toBe(true);
    expect(provider.supports({ destinationCountry: "ng" })).toBe(true);
    expect(provider.supports({ destinationCountry: "US" })).toBe(false);
    expect(provider.supports({})).toBe(true);
  });

  it("accepts DLR callbacks (unsigned — authenticated at the ingress layer)", () => {
    expect(provider.verifyWebhook({ headers: {}, rawBody: "" }, CREDS)).toBe(
      true,
    );
  });
});
