import {
  listSendersResponseSchema,
  listWebhookEndpointsResponseSchema,
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
