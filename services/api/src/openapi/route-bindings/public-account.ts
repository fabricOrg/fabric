import {
  createApplicationRequestSchema,
  createSmsTemplateRequest,
  createWebhookEndpointRequestSchema,
  initiateTopUpRequestSchema,
  listWebhookDeliveriesResponseSchema,
  listWebhookEndpointsResponseSchema,
  purchaseCommercialOfferRequestSchema,
  replayWebhookDeliveryResponseSchema,
  updateAutoTopupRequestSchema,
  updateSmsTemplateRequest,
  walletSnapshot,
} from "@app/contracts";
import type { RouteBindings } from "../route-binding.types.js";

/**
 * Account, money and developer-tooling surface.
 *
 * WORTH KNOWING: several of these (`/v1/overview`, `/v1/flows`, `/v1/logs`,
 * `/v1/sandbox-allowances`, `/v1/tokens`) read like dashboard features, and they are — but they sit
 * behind `ApiKeyGuard`, so a customer `sk_*` key already reaches them. They are marked `public`
 * because that is the truth of the guard, not an endorsement. If any of them is meant to be
 * dashboard-only, the fix is the guard, not the documentation.
 */
export const PUBLIC_ACCOUNT_BINDINGS: RouteBindings = {
  // ---- Wallet and payments -----------------------------------------------------------------
  "GET /v1/wallet": {
    summary: "Retrieve the wallet",
    description:
      "Balances are exact minor units as strings — never parse them as JSON numbers.",
    tags: ["Wallet"],
    visibility: "public",
    security: ["secretKey"],
    response: walletSnapshot,
  },
  "GET /v1/wallet/statement": {
    summary: "Retrieve the wallet statement",
    tags: ["Wallet"],
    visibility: "public",
    security: ["secretKey"],
  },
  "POST /v1/wallet/topup": {
    summary: "Start a wallet top-up",
    description:
      "Returns a hosted checkout to redirect to. The wallet is credited only after the provider " +
      "webhook verifies the payment — the browser redirect alone never credits.",
    tags: ["Wallet"],
    visibility: "public",
    security: ["secretKey"],
    request: initiateTopUpRequestSchema,
    errorStatuses: [409],
  },
  "GET /v1/wallet/auto-topup": {
    summary: "Retrieve auto top-up settings",
    tags: ["Wallet"],
    visibility: "public",
    security: ["secretKey"],
  },
  "PUT /v1/wallet/auto-topup": {
    summary: "Update auto top-up settings",
    tags: ["Wallet"],
    visibility: "public",
    security: ["secretKey"],
    request: updateAutoTopupRequestSchema,
  },
  "GET /v1/wallet/payment-method": {
    summary: "Retrieve the stored payment method",
    tags: ["Wallet"],
    visibility: "public",
    security: ["secretKey"],
  },

  // ---- Tokens ------------------------------------------------------------------------------
  "GET /v1/tokens": {
    summary: "Retrieve token balances",
    tags: ["Tokens"],
    visibility: "public",
    security: ["secretKey"],
  },
  "GET /v1/tokens/catalog": {
    summary: "List purchasable token offers",
    tags: ["Tokens"],
    visibility: "public",
    security: ["secretKey"],
  },
  "POST /v1/tokens/purchase": {
    summary: "Purchase tokens",
    tags: ["Tokens"],
    visibility: "public",
    security: ["secretKey"],
    errorStatuses: [402, 409],
    request: purchaseCommercialOfferRequestSchema,
  },
  "GET /v1/tokens/purchases": {
    summary: "List token purchases",
    tags: ["Tokens"],
    visibility: "public",
    security: ["secretKey"],
  },
  "GET /v1/tokens/purchases/:reference": {
    summary: "Retrieve a purchase receipt",
    tags: ["Tokens"],
    visibility: "public",
    security: ["secretKey"],
    errorStatuses: [404],
  },

  // ---- Webhook endpoint management ---------------------------------------------------------
  "GET /v1/webhooks": {
    summary: "List webhook endpoints",
    tags: ["Webhooks"],
    visibility: "public",
    security: ["secretKey"],
    response: listWebhookEndpointsResponseSchema,
  },
  "POST /v1/webhooks": {
    summary: "Create a webhook endpoint",
    description: "The signing secret is returned once and never again.",
    tags: ["Webhooks"],
    visibility: "public",
    security: ["secretKey"],
    request: createWebhookEndpointRequestSchema,
    successStatus: 201,
  },
  "DELETE /v1/webhooks/:id": {
    summary: "Delete a webhook endpoint",
    tags: ["Webhooks"],
    visibility: "public",
    security: ["secretKey"],
    successStatus: 204,
    errorStatuses: [404],
  },
  "GET /v1/webhooks/:id/deliveries": {
    summary: "List deliveries for an endpoint",
    tags: ["Webhooks"],
    visibility: "public",
    security: ["secretKey"],
    response: listWebhookDeliveriesResponseSchema,
    errorStatuses: [404],
  },
  "POST /v1/webhooks/:id/deliveries/:deliveryId/replay": {
    summary: "Replay a webhook delivery",
    tags: ["Webhooks"],
    visibility: "public",
    security: ["secretKey"],
    response: replayWebhookDeliveryResponseSchema,
    errorStatuses: [404],
  },

  // ---- Keys, applications, context ---------------------------------------------------------
  "GET /v1/api-keys": {
    summary: "List API keys",
    tags: ["Applications"],
    visibility: "public",
    security: ["secretKey", "operatorToken"],
  },
  "POST /v1/api-keys": {
    summary: "Create an API key",
    description:
      "The secret is shown once. It is stored hashed and cannot be recovered.",
    tags: ["Applications"],
    visibility: "public",
    security: ["secretKey", "operatorToken"],
    successStatus: 201,
    // TODO(contract): the handler parses this body ad hoc — `(body ?? {}) as Record<string, unknown>`
    // with manual field extraction and no zod DTO, so there is nothing to reference. Same defect
    // family as the untyped BFF mutation bodies; the fix is a contract, not a doc entry.
  },
  "DELETE /v1/api-keys/:id": {
    summary: "Revoke an API key",
    tags: ["Applications"],
    visibility: "public",
    security: ["secretKey", "operatorToken"],
    successStatus: 204,
    errorStatuses: [404],
  },
  "GET /v1/applications": {
    summary: "List applications",
    tags: ["Applications"],
    visibility: "public",
    security: ["secretKey", "operatorToken"],
  },
  "POST /v1/applications": {
    summary: "Create an application",
    description:
      "A new application is provisioned with isolated sandbox and live environments.",
    tags: ["Applications"],
    visibility: "public",
    security: ["secretKey", "operatorToken"],
    successStatus: 201,
    request: createApplicationRequestSchema,
  },
  "GET /v1/context": {
    summary: "Retrieve the calling key's context",
    description:
      "Which workspace, application and environment the presented key resolves to.",
    tags: ["Applications"],
    visibility: "public",
    security: ["secretKey"],
  },

  // ---- Dashboard-shaped, but key-reachable (see the file header) ---------------------------
  "GET /v1/overview": {
    summary: "Retrieve the account overview",
    tags: ["Account"],
    visibility: "public",
    security: ["secretKey"],
  },
  "GET /v1/logs": {
    summary: "List API request logs",
    tags: ["Account"],
    visibility: "public",
    security: ["secretKey"],
  },
  "GET /v1/sandbox-allowances": {
    summary: "Retrieve sandbox allowance usage",
    description:
      "Sandbox traffic is metered against a daily allowance rather than priced.",
    tags: ["Account"],
    visibility: "public",
    security: ["secretKey"],
  },
  "GET /v1/flows": {
    summary: "List reconciled transaction flows",
    tags: ["Account"],
    visibility: "public",
    security: ["secretKey"],
  },
  "POST /v1/flows": {
    summary: "Run a transaction flow",
    tags: ["Account"],
    visibility: "public",
    security: ["secretKey"],
    errorStatuses: [402],
    // TODO(contract): the body is a discriminated union resolved at runtime on `action` —
    // `startFlowRequest` OR `confirmFlowRequest`. A binding names one contract and must not compose
    // shapes, so this stays unmodelled until the API exposes a single union DTO.
  },
  "GET /v1/public/pricing": {
    summary: "Retrieve published pricing",
    description:
      "Unauthenticated on purpose — this is the public rate card the marketing site reads.",
    tags: ["Pricing"],
    visibility: "public",
    security: ["none"],
  },

  // ---- SMS templates -----------------------------------------------------------------------
  "GET /v1/sms/templates": {
    summary: "List SMS templates",
    tags: ["SMS"],
    visibility: "public",
    security: ["secretKey"],
  },
  "POST /v1/sms/templates": {
    summary: "Create an SMS template",
    tags: ["SMS"],
    visibility: "public",
    security: ["secretKey"],
    successStatus: 201,
    request: createSmsTemplateRequest,
  },
  "PATCH /v1/sms/templates/:id": {
    summary: "Update an SMS template",
    tags: ["SMS"],
    visibility: "public",
    security: ["secretKey"],
    errorStatuses: [404],
    request: updateSmsTemplateRequest,
  },
  "DELETE /v1/sms/templates/:id": {
    summary: "Delete an SMS template",
    tags: ["SMS"],
    visibility: "public",
    security: ["secretKey"],
    successStatus: 204,
    errorStatuses: [404],
  },
};
