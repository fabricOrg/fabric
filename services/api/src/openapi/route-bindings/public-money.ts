import {
  autoTopupResponseSchema,
  initiateTopUpRequestSchema,
  initiateTopUpResponseSchema,
  paymentMethodResponseSchema,
  purchaseCommercialOfferRequestSchema,
  purchaseCommercialOfferResponseSchema,
  tokenBalancesResponseSchema,
  updateAutoTopupRequestSchema,
  walletSnapshot,
} from "@app/contracts";
import type { RouteBindings } from "../route-binding.types.js";

/**
 * Wallet, payments and tokens — the customer-facing money surface. Split from `public-account.ts`
 * to stay under the file-length guard.
 *
 * Balances and costs cross the wire as EXACT DECIMAL STRINGS, never JSON numbers: the domain holds
 * money as bigint minor units, and a number loses precision past 2^53. The generated schemas say so,
 * so a generated client cannot get it wrong by accident.
 */
export const PUBLIC_MONEY_BINDINGS: RouteBindings = {
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
    response: initiateTopUpResponseSchema,
  },
  "GET /v1/wallet/auto-topup": {
    summary: "Retrieve auto top-up settings",
    tags: ["Wallet"],
    visibility: "public",
    security: ["secretKey"],
    response: autoTopupResponseSchema,
  },
  "PUT /v1/wallet/auto-topup": {
    summary: "Update auto top-up settings",
    tags: ["Wallet"],
    visibility: "public",
    security: ["secretKey"],
    request: updateAutoTopupRequestSchema,
    response: autoTopupResponseSchema,
  },
  "GET /v1/wallet/payment-method": {
    summary: "Retrieve the stored payment method",
    tags: ["Wallet"],
    visibility: "public",
    security: ["secretKey"],
    response: paymentMethodResponseSchema,
  },

  // ---- Tokens ------------------------------------------------------------------------------
  "GET /v1/tokens": {
    summary: "Retrieve token balances",
    tags: ["Tokens"],
    visibility: "public",
    security: ["secretKey"],
    response: tokenBalancesResponseSchema,
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
    response: purchaseCommercialOfferResponseSchema,
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
};
