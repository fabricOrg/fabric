import {
  addMessageDefinitionVersionRequest,
  createMessageDefinitionRequest,
  createOptOutRequestSchema,
  createSenderRequestSchema,
  listMessageDefinitionsResponse,
  listMessageDeliveriesResponse,
  messageDefinitionState,
  messageDeliveryWebhooksResponse,
  publishMessageDefinitionRequest,
  retrieveManagedMessageResponse,
  sendManagedMessageRequest,
  sendManagedMessageResponse,
} from "@app/contracts";
import type { RouteBindings } from "../route-binding.types.js";

/**
 * Managed messaging, message definitions, senders and opt-outs — the part of the customer surface
 * where content and compliance live rather than raw sends. Split from `public-messaging.ts` only to
 * stay under the file-length guard; the visibility rules are identical.
 */
export const PUBLIC_MANAGED_BINDINGS: RouteBindings = {
  // ---- Managed messaging -------------------------------------------------------------------
  "POST /v1/message-deliveries": {
    summary: "Deliver a managed message",
    description:
      "Sends by stable definition key. The channel is resolved server-side from the released " +
      "version, so a caller never picks a transport.",
    tags: ["Message deliveries"],
    visibility: "public",
    security: ["secretKey"],
    request: sendManagedMessageRequest,
    response: sendManagedMessageResponse,
    successStatus: 202,
    errorStatuses: [402, 409],
  },
  "GET /v1/message-deliveries": {
    summary: "List managed deliveries",
    tags: ["Message deliveries"],
    visibility: "public",
    security: ["secretKey"],
    response: listMessageDeliveriesResponse,
  },
  "GET /v1/message-deliveries/:id": {
    summary: "Retrieve a managed delivery",
    tags: ["Message deliveries"],
    visibility: "public",
    security: ["secretKey"],
    response: retrieveManagedMessageResponse,
    errorStatuses: [404],
  },
  "GET /v1/message-deliveries/:id/webhooks": {
    summary: "List webhooks emitted for a delivery",
    tags: ["Message deliveries"],
    visibility: "public",
    security: ["secretKey"],
    response: messageDeliveryWebhooksResponse,
    errorStatuses: [404],
  },

  // ---- Message definitions -----------------------------------------------------------------
  "GET /v1/message-definitions": {
    summary: "List message definitions",
    tags: ["Message definitions"],
    visibility: "public",
    security: ["secretKey", "operatorToken"],
    response: listMessageDefinitionsResponse,
  },
  "POST /v1/message-definitions": {
    summary: "Create a message definition",
    tags: ["Message definitions"],
    visibility: "public",
    security: ["secretKey", "operatorToken"],
    request: createMessageDefinitionRequest,
    response: messageDefinitionState,
    successStatus: 201,
  },
  "POST /v1/message-definitions/:id/versions": {
    summary: "Add an immutable version",
    description:
      "Rejected when the schema change is breaking against the latest version, or when the " +
      "channel differs — channel is immutable across versions.",
    tags: ["Message definitions"],
    visibility: "public",
    security: ["secretKey", "operatorToken"],
    request: addMessageDefinitionVersionRequest,
    response: messageDefinitionState,
    successStatus: 201,
  },
  "POST /v1/message-definitions/:id/publish": {
    summary: "Release a version to an environment",
    tags: ["Message definitions"],
    visibility: "public",
    security: ["secretKey", "operatorToken"],
    request: publishMessageDefinitionRequest,
    response: messageDefinitionState,
  },
  "POST /v1/message-definitions/:id/archive": {
    summary: "Archive a definition",
    tags: ["Message definitions"],
    visibility: "public",
    security: ["secretKey", "operatorToken"],
    response: messageDefinitionState,
  },
  "GET /v1/definitions/catalog": {
    summary: "Retrieve the generated definition catalog",
    description: "Feeds the typed SDK catalog that can fail CI on drift.",
    tags: ["Message definitions"],
    visibility: "public",
    security: ["secretKey"],
  },

  // ---- Senders and opt-outs ----------------------------------------------------------------
  "GET /v1/senders": {
    summary: "List sender IDs",
    tags: ["Sender IDs"],
    visibility: "public",
    security: ["secretKey", "bffInternal"],
  },
  "POST /v1/senders": {
    summary: "Register a sender ID",
    description:
      "Registration is per country and per operator and takes days. Sends on an unapproved sender " +
      "are blocked before dispatch.",
    tags: ["Sender IDs"],
    visibility: "public",
    security: ["secretKey", "bffInternal"],
    request: createSenderRequestSchema,
    successStatus: 201,
  },
  "GET /v1/opt-outs": {
    summary: "List opt-outs",
    tags: ["Compliance"],
    visibility: "public",
    security: ["secretKey"],
  },
  "POST /v1/opt-outs": {
    summary: "Add an opt-out",
    description:
      "`promotional` suppresses marketing only; `all` suppresses everything. Checked before every " +
      "send.",
    tags: ["Compliance"],
    visibility: "public",
    security: ["secretKey"],
    request: createOptOutRequestSchema,
    successStatus: 201,
  },
  "DELETE /v1/opt-outs/:id": {
    summary: "Remove an opt-out",
    tags: ["Compliance"],
    visibility: "public",
    security: ["secretKey"],
    successStatus: 204,
    errorStatuses: [404],
  },
};
