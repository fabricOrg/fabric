import {
  emailMessageResponse,
  listSendersResponseSchema,
  listWebhookDeliveriesResponseSchema,
  listWebhookEndpointsResponseSchema,
  previewMessageResponse,
  replayWebhookDeliveryResponseSchema,
  verifyCheckResponse,
  verifyStartResponse,
  walletSnapshot,
} from "@app/contracts";
import { describe, expect, it, vi } from "vitest";
import { Fabric, ResponseValidationError } from "./index.js";

const sender = {
  id: "5a344e61-16c4-4e07-924f-fabdfb81fa14",
  sender_id: "Fabric",
  country: "GH",
  type: "alphanumeric",
  use_case: "Transactional account notifications",
  status: "active",
  rejection_reason: null,
  created_at: "2026-07-12T12:00:00.000Z",
} as const;

describe("canonical contract parity", () => {
  it("maps canonical sender ID responses", async () => {
    const payload = listSendersResponseSchema.parse({ senders: [sender] });
    const client = clientReturning(payload);
    await expect(client.senderIds.list()).resolves.toMatchObject({
      data: [{ senderId: "Fabric", country: "GH", status: "active" }],
    });
  });

  it("maps both canonical Verify response variants", async () => {
    const started = verifyStartResponse.parse({
      id: "2ccb4b9f-384e-4f4e-8983-ff12555223d0",
      status: "pending",
      to: "+23354•••7189",
      channel: "sms",
      expires_in: 300,
      debug_code: "123456",
    });
    await expect(
      clientReturning(started).verify.start({ to: "+233545227189" }),
    ).resolves.toMatchObject({
      data: { status: "pending", expiresIn: 300, debugCode: "123456" },
    });
    const checked = verifyCheckResponse.parse({
      id: "2ccb4b9f-384e-4f4e-8983-ff12555223d0",
      status: "verified",
      verified_at: "2026-07-12T12:01:00.000Z",
    });
    await expect(
      clientReturning(checked).verify.check({ id: checked.id, code: "123456" }),
    ).resolves.toMatchObject({
      data: { status: "verified", verifiedAt: checked.verified_at },
    });
  });

  it("maps canonical wallet responses without losing exact minor units", async () => {
    const payload = walletSnapshot.parse({
      balances: [{ balance: { minor: "120403", currency: "GHS" } }],
      ledger: [
        {
          id: "led_1",
          type: "topup",
          direction: "credit",
          amount: { minor: "120403", currency: "GHS" },
          runningBalance: { minor: "120403", currency: "GHS" },
          createdAt: "2026-07-12T12:00:00.000Z",
        },
      ],
      request_id: "req_wallet",
    });
    await expect(
      clientReturning(payload).wallet.retrieve(),
    ).resolves.toMatchObject({
      requestId: "req_wallet",
      data: { balances: [{ balance: { minor: "120403", currency: "GHS" } }] },
    });
  });

  it("maps canonical webhook endpoint responses", async () => {
    const payload = listWebhookEndpointsResponseSchema.parse({
      endpoints: [
        {
          id: "98393ec2-2a34-4cb8-b3cc-4e25ec8b6c17",
          url: "https://example.com/webhooks/fabric",
          status: "active",
          description: null,
          env: "sandbox",
          secret_prefix: "whsec_abcd",
          created_at: "2026-07-12T12:00:00.000Z",
          health: { pending: 0, dead: 0, last_delivered_at: null },
        },
      ],
      request_id: "req_webhooks",
    });
    await expect(
      clientReturning(payload).webhooks.list(),
    ).resolves.toMatchObject({
      data: [{ environment: "sandbox", secretPrefix: "whsec_abcd" }],
    });
  });

  it("maps delivery history and replay responses", async () => {
    const delivery = {
      id: "98393ec2-2a34-4cb8-b3cc-4e25ec8b6c18",
      endpoint_id: "98393ec2-2a34-4cb8-b3cc-4e25ec8b6c17",
      event_id: "98393ec2-2a34-4cb8-b3cc-4e25ec8b6c19",
      event_type: "message.delivered",
      state: "dead" as const,
      attempts: 10,
      next_attempt_at: "2026-07-12T12:10:00.000Z",
      last_attempt_at: "2026-07-12T12:09:00.000Z",
      delivered_at: null,
      last_error_category: "http_5xx",
      last_http_status: 500,
      created_at: "2026-07-12T12:00:00.000Z",
    };
    const listed = listWebhookDeliveriesResponseSchema.parse({
      deliveries: [delivery],
      next_cursor: null,
      request_id: "req_deliveries",
    });
    await expect(
      clientReturning(listed).webhooks.listDeliveries(delivery.endpoint_id, {
        state: "dead",
      }),
    ).resolves.toMatchObject({
      data: {
        items: [{ eventId: delivery.event_id, lastHttpStatus: 500 }],
        nextCursor: null,
      },
    });
    const replayed = replayWebhookDeliveryResponseSchema.parse({
      delivery: { ...delivery, state: "pending", attempts: 10 },
      request_id: "req_replay",
    });
    await expect(
      clientReturning(replayed).webhooks.replayDelivery(
        delivery.endpoint_id,
        delivery.id,
      ),
    ).resolves.toMatchObject({ data: { state: "pending", attempts: 10 } });
  });

  it("maps canonical Email responses", async () => {
    const payload = emailMessageResponse.parse({
      message: {
        id: "98393ec2-2a34-4cb8-b3cc-4e25ec8b6c17",
        status: "delivered",
        to: "recipient@example.com",
        from: "hello@merchant.example",
        subject: "Welcome",
        provider: "sandbox-email",
        created_at: "2026-07-13T01:00:00.000Z",
        error_code: null,
      },
      request_id: "req_email",
    });
    await expect(
      clientReturning(payload).email.retrieve(payload.message.id),
    ).resolves.toMatchObject({
      requestId: "req_email",
      data: { status: "delivered", subject: "Welcome", errorCode: null },
    });
  });

  it("maps durable SMS batch outcomes", async () => {
    const payload = {
      id: "98393ec2-2a34-4cb8-b3cc-4e25ec8b6c17",
      status: "completed",
      total_count: 2,
      accepted_count: 1,
      failed_count: 1,
      items: [
        {
          client_reference: "one",
          message_id: "5a344e61-16c4-4e07-924f-fabdfb81fa14",
          status: "delivered",
          error_code: null,
        },
        {
          client_reference: "two",
          message_id: null,
          status: "failed",
          error_code: "invalid_sms",
        },
      ],
      request_id: "req_batch",
    };
    await expect(
      clientReturning(payload).sms.retrieveBatch(payload.id),
    ).resolves.toMatchObject({
      requestId: "req_batch",
      data: {
        status: "completed",
        acceptedCount: 1,
        items: [{ clientReference: "one" }, { errorCode: "invalid_sms" }],
      },
    });
  });

  it("maps a canonical message preview response", async () => {
    const payload = previewMessageResponse.parse({
      channel: "sms",
      version_id: "2ccb4b9f-384e-4f4e-8983-ff12555223d0",
      environment: "sandbox",
      resolved_locale: "en",
      blockers: [],
      warnings: [{ path: "to", code: "recipient_not_provided" }],
      eligible: true,
      sender: { sender_id: "FABRIC", status: "sandbox" },
      message_class: "transactional",
      preview: {
        body: "Hi Ada",
        encoding: "gsm7",
        length: 6,
        segments: 1,
        cost_minor: "3",
        currency: "GHS",
      },
      email_preview: null,
      request_id: "req_1",
    });
    await expect(
      clientReturning(payload).messages.preview("order.shipped", {
        data: { name: "Ada" },
      }),
    ).resolves.toMatchObject({
      data: {
        versionId: "2ccb4b9f-384e-4f4e-8983-ff12555223d0",
        environment: "sandbox",
        resolvedLocale: "en",
        blockers: [],
        warnings: [{ code: "recipient_not_provided" }],
        eligible: true,
        sender: { senderId: "FABRIC", status: "sandbox" },
        messageClass: "transactional",
        preview: { encoding: "gsm7", segments: 1, costMinor: "3" },
      },
    });
  });

  it.each([
    [
      "sender IDs",
      () =>
        clientReturning({
          senders: [{ ...sender, status: "unknown" }],
        }).senderIds.list(),
    ],
    [
      "Verify",
      () =>
        clientReturning({ id: "v", status: "mystery" }).verify.start({
          to: "+233545227189",
        }),
    ],
    [
      "Wallet",
      () =>
        clientReturning({
          balances: [{ balance: { minor: 1, currency: "GHS" } }],
          ledger: [],
        }).wallet.retrieve(),
    ],
    [
      "Email",
      () =>
        clientReturning({ message: { status: "unknown" } }).email.retrieve(
          "email_1",
        ),
    ],
    [
      "Webhooks",
      () =>
        clientReturning({ endpoints: [{ env: "sandbox" }] }).webhooks.list(),
    ],
  ])("fails closed for malformed %s success responses", async (_name, request) => {
    await expect(request()).rejects.toBeInstanceOf(ResponseValidationError);
  });
});

function clientReturning(payload: unknown): Fabric {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  return new Fabric({ apiKey: "sk_test_contract", fetch });
}
