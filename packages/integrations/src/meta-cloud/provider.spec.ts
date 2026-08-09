import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Creds, NormalizedWhatsAppTemplateMessage } from "../plugin.js";
import { MetaCloudError, MetaCloudProvider } from "./provider.js";

const APP_SECRET = "test-secret";

const CREDS: Creds = {
  phone_number_id: "123456789",
  waba_id: "987654321",
  access_token: "test-token",
  app_secret: APP_SECRET,
  webhook_verify_token: "verify-token",
};

const MESSAGE: NormalizedWhatsAppTemplateMessage = {
  messageId: "8f900e21-c1f3-4cd4-b94b-b3a37cb085b7",
  to: "+233241234567",
  templateName: "order_update",
  templateLanguage: "en",
  templateCategory: "utility",
  variables: ["Ada", "A-123"],
};

function signed(rawBody: string, secret = APP_SECRET): string {
  return `sha256=${createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex")}`;
}

describe("MetaCloudProvider.send", () => {
  it("posts a template message and returns the Meta message id", async () => {
    const transport = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: "wamid.test" }] }), {
        status: 200,
      }),
    );
    const provider = new MetaCloudProvider(transport);

    await expect(provider.send(MESSAGE, CREDS)).resolves.toMatchObject({
      status: "accepted",
      providerRef: "wamid.test",
    });
    expect(transport.mock.calls[0]?.[0]).toContain("/123456789/messages");
    const init = transport.mock.calls[0]?.[1];
    expect(init?.headers.authorization).toBe("Bearer test-token");
    expect(JSON.parse(init?.body ?? "{}")).toMatchObject({
      messaging_product: "whatsapp",
      to: MESSAGE.to,
      template: {
        name: "order_update",
        language: { code: "en" },
      },
    });
  });

  it.each([
    "phone_number_id",
    "waba_id",
    "access_token",
    "app_secret",
    "webhook_verify_token",
  ] as const)("throws a structured error when %s is missing", async (field) => {
    const transport = vi.fn();
    const provider = new MetaCloudProvider(transport);
    const creds: Record<string, string> = { ...CREDS };
    delete creds[field];

    await expect(provider.send(MESSAGE, creds)).rejects.toMatchObject({
      code: "whatsapp_invalid_credentials",
      param: field,
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it("maps a clean provider refusal to failed without throwing", async () => {
    const provider = new MetaCloudProvider(
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { message: "Template is paused" } }),
            { status: 400 },
          ),
        ),
    );

    await expect(provider.send(MESSAGE, CREDS)).resolves.toMatchObject({
      status: "failed",
    });
  });

  it("throws a structured anomaly when Meta omits the message id", async () => {
    const provider = new MetaCloudProvider(
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })),
    );

    await expect(provider.send(MESSAGE, CREDS)).rejects.toMatchObject({
      code: "whatsapp_provider_anomaly",
    });
  });

  it("throws a structured provider error for auth and server faults", async () => {
    const provider = new MetaCloudProvider(
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "Bad token" } }), {
          status: 401,
        }),
      ),
    );

    await expect(provider.send(MESSAGE, CREDS)).rejects.toBeInstanceOf(
      MetaCloudError,
    );
    await expect(provider.send(MESSAGE, CREDS)).rejects.toMatchObject({
      code: "whatsapp_provider_unavailable",
    });
  });
});

describe("MetaCloudProvider.listTemplates", () => {
  it("lists paginated WABA templates without making a live call in tests", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                name: "order_update",
                language: "en",
                category: "UTILITY",
                status: "APPROVED",
                quality_score: { score: "GREEN" },
                components: [{ type: "BODY", text: "Hi" }],
              },
            ],
            paging: { next: "https://graph.facebook.com/v20.0/next" },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                name: "promo",
                language: "en",
                category: "MARKETING",
                status: "PAUSED",
              },
            ],
          }),
          { status: 200 },
        ),
      );
    const provider = new MetaCloudProvider(transport);

    await expect(provider.listTemplates(CREDS)).resolves.toEqual([
      {
        wabaId: "987654321",
        name: "order_update",
        language: "en",
        category: "UTILITY",
        status: "APPROVED",
        qualityRating: "GREEN",
        components: [{ type: "BODY", text: "Hi" }],
      },
      {
        wabaId: "987654321",
        name: "promo",
        language: "en",
        category: "MARKETING",
        status: "PAUSED",
        qualityRating: null,
        components: [],
      },
    ]);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[0]?.[0]).toContain(
      "/987654321/message_templates",
    );
  });
});

describe("MetaCloudProvider.verifyWebhook", () => {
  const provider = new MetaCloudProvider();
  const rawBody = JSON.stringify({ object: "whatsapp_business_account" });

  it("accepts a valid X-Hub-Signature-256 signature", () => {
    expect(
      provider.verifyWebhook(
        {
          headers: { "x-hub-signature-256": signed(rawBody) },
          rawBody,
        },
        CREDS,
      ),
    ).toBe(true);
  });

  // Meta signs the exact bytes, and the Phase 1d route hands over Fastify's `request.rawBody`, which
  // is a Buffer — not the string this spec's other cases use. Verifying the byte path explicitly is
  // the difference between "our helper picks the right branch" and "we assume it does": a string-only
  // contract silently depends on the ingress having decoded losslessly.
  it("accepts the same signature when the body arrives as raw bytes", () => {
    expect(
      provider.verifyWebhook(
        {
          headers: { "x-hub-signature-256": signed(rawBody) },
          rawBody: Buffer.from(rawBody, "utf8"),
        },
        CREDS,
      ),
    ).toBe(true);
  });

  it("rejects tampered raw bytes", () => {
    expect(
      provider.verifyWebhook(
        {
          headers: { "x-hub-signature-256": signed(rawBody) },
          rawBody: Buffer.from(`${rawBody} `, "utf8"),
        },
        CREDS,
      ),
    ).toBe(false);
  });

  it("rejects a tampered body", () => {
    expect(
      provider.verifyWebhook(
        {
          headers: { "x-hub-signature-256": signed(rawBody) },
          rawBody: `${rawBody} `,
        },
        CREDS,
      ),
    ).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(
      provider.verifyWebhook(
        {
          headers: { "x-hub-signature-256": signed(rawBody, "wrong-secret") },
          rawBody,
        },
        CREDS,
      ),
    ).toBe(false);
  });

  it.each([{}, { app_secret: "" }])(
    "rejects a missing or empty app secret",
    (creds) => {
      expect(
        provider.verifyWebhook(
          {
            headers: { "x-hub-signature-256": signed(rawBody) },
            rawBody,
          },
          creds,
        ),
      ).toBe(false);
    },
  );

  it("handles signatures without throwing when lengths differ", () => {
    expect(
      provider.verifyWebhook(
        {
          headers: { "x-hub-signature-256": "sha256=deadbeef" },
          rawBody,
        },
        CREDS,
      ),
    ).toBe(false);
  });
});

describe("MetaCloudProvider.parseDlr", () => {
  const provider = new MetaCloudProvider();

  it("maps a Meta status callback to the canonical DLR shape", () => {
    expect(
      provider.parseDlr({
        entry: [
          {
            changes: [
              {
                value: {
                  statuses: [
                    {
                      id: "wamid.test",
                      status: "delivered",
                      timestamp: "1723075200",
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    ).toMatchObject({
      providerRef: "wamid.test",
      status: "delivered",
      occurredAt: "2024-08-08T00:00:00.000Z",
    });
  });

  it.each([null, {}, { entry: [{}] }, { entry: [{ changes: [] }] }])(
    "throws a structured error for truncated payload %#",
    (payload) => {
      expect(() => provider.parseDlr(payload)).toThrow(MetaCloudError);
      expect(() => provider.parseDlr(payload)).toThrow(
        /Unparseable or unmapped/,
      );
    },
  );
});
