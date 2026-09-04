import {
  emailMessageListResponse,
  emailMessageResponse,
  messageDetailResponse,
  messageListResponse,
  messagingInsightsResponse,
  pageQuery,
  previewMessageRequest,
  previewMessageResponse,
  sendEmailApiResponse,
  sendEmailRequest,
  sendSmsApiResponse,
  sendSmsBatchRequest,
  sendSmsRequest,
  smsBatchResponse,
  verifyCheckRequest,
  verifyCheckResponse,
  verifyOverviewResponse,
  verifyStartRequest,
  verifyStartResponse,
  whatsappMessageListResponse,
  whatsappMessageResponse,
  whatsappSendRequest,
  whatsappSendResponse,
} from "@app/contracts";
import type { RouteBindings } from "../route-binding.types.js";

/**
 * The customer messaging surface — everything an `sk_*` key sends with. All `public`, because
 * `ApiKeyGuard` already opens them to any customer key: hiding a key-reachable route from the spec
 * is obscurity, not access control.
 */
export const PUBLIC_MESSAGING_BINDINGS: RouteBindings = {
  // ---- SMS ---------------------------------------------------------------------------------
  "POST /v1/sms/messages": {
    summary: "Send an SMS",
    description:
      "Reserves wallet funds and enqueues the message. 202 means ACCEPTED, not delivered — follow " +
      "the terminal status by webhook or by retrieving the message.",
    tags: ["SMS"],
    visibility: "public",
    security: ["secretKey", "tenantToken"],
    request: sendSmsRequest,
    idempotency: "optional",
    response: sendSmsApiResponse,
    successStatus: 202,
    errorStatuses: [402, 409],
  },
  "GET /v1/sms/:id": {
    summary: "Retrieve an SMS",
    tags: ["SMS"],
    visibility: "public",
    security: ["secretKey", "tenantToken"],
    response: messageDetailResponse,
    errorStatuses: [404],
  },
  "GET /v1/messages": {
    summary: "List messages",
    tags: ["SMS"],
    visibility: "public",
    security: ["secretKey", "tenantToken"],
    response: messageListResponse,
    query: pageQuery,
  },
  "GET /v1/messages/insights": {
    summary: "Retrieve messaging insights",
    tags: ["SMS"],
    visibility: "public",
    security: ["secretKey", "tenantToken"],
    response: messagingInsightsResponse,
  },
  "POST /v1/messages/preview": {
    summary: "Preview a message without sending",
    description:
      "Runs the same render, segmentation and pricing path as a send, so the quoted cost matches " +
      "what a send would charge.",
    tags: ["SMS"],
    visibility: "public",
    security: ["secretKey", "tenantToken"],
    request: previewMessageRequest,
    response: previewMessageResponse,
  },
  "POST /v1/sms/batches": {
    summary: "Send a batch of SMS",
    description: "Up to 100 items with durable per-item outcomes.",
    tags: ["SMS"],
    visibility: "public",
    security: ["secretKey", "tenantToken"],
    request: sendSmsBatchRequest,
    idempotency: "required",
    response: smsBatchResponse,
    successStatus: 202,
    errorStatuses: [402, 409],
  },
  "GET /v1/sms/batches/:id": {
    summary: "Retrieve a batch",
    tags: ["SMS"],
    visibility: "public",
    security: ["secretKey", "tenantToken"],
    response: smsBatchResponse,
    errorStatuses: [404],
  },

  // ---- Email -------------------------------------------------------------------------------
  "POST /v1/email/messages": {
    summary: "Send an email",
    description:
      "Live sending fails closed until a provider is armed and the sending domain is verified.",
    tags: ["Email"],
    visibility: "public",
    security: ["secretKey", "tenantToken"],
    request: sendEmailRequest,
    idempotency: "optional",
    response: sendEmailApiResponse,
    successStatus: 202,
    errorStatuses: [402, 409],
  },
  "GET /v1/email/messages": {
    summary: "List emails",
    tags: ["Email"],
    visibility: "public",
    security: ["secretKey", "tenantToken"],
    response: emailMessageListResponse,
    query: pageQuery,
  },
  "GET /v1/email/messages/:id": {
    summary: "Retrieve an email",
    tags: ["Email"],
    visibility: "public",
    security: ["secretKey", "tenantToken"],
    response: emailMessageResponse,
    errorStatuses: [404],
  },

  // ---- WhatsApp ----------------------------------------------------------------------------
  "POST /v1/whatsapp/messages": {
    summary: "Send a WhatsApp message",
    description:
      "Content lives in a Meta-approved template, so the request carries a BINDING and ordered " +
      "parameters rather than a body. Parameter order is positional on the wire — reordering it " +
      "silently changes which value lands where.",
    tags: ["WhatsApp"],
    visibility: "public",
    security: ["secretKey", "tenantToken"],
    request: whatsappSendRequest,
    idempotency: "required",
    response: whatsappSendResponse,
    successStatus: 202,
    errorStatuses: [402, 409],
  },
  "GET /v1/whatsapp/messages": {
    summary: "List WhatsApp messages",
    tags: ["WhatsApp"],
    visibility: "public",
    security: ["secretKey", "tenantToken"],
    response: whatsappMessageListResponse,
    query: pageQuery,
  },
  "GET /v1/whatsapp/messages/:id": {
    summary: "Retrieve a WhatsApp message",
    tags: ["WhatsApp"],
    visibility: "public",
    security: ["secretKey", "tenantToken"],
    response: whatsappMessageResponse,
    errorStatuses: [404],
  },

  // ---- Verify ------------------------------------------------------------------------------
  "POST /v1/verify": {
    summary: "Start a verification",
    tags: ["Verify"],
    visibility: "public",
    security: ["secretKey", "tenantToken"],
    successStatus: 201,
    request: verifyStartRequest,
    idempotency: "optional",
    errorStatuses: [402, 409, 429],
    response: verifyStartResponse,
  },
  "POST /v1/verify/check": {
    summary: "Check a verification code",
    tags: ["Verify"],
    visibility: "public",
    security: ["secretKey", "tenantToken"],
    request: verifyCheckRequest,
    response: verifyCheckResponse,
  },
  "GET /v1/verify/overview": {
    summary: "Retrieve verification metrics",
    tags: ["Verify"],
    visibility: "public",
    security: ["secretKey", "tenantToken"],
    response: verifyOverviewResponse,
  },
};
