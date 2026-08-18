import {
  acceptedAck,
  batchIngestAck,
  healthLiveResponse,
  healthReadyResponse,
  ingestAck,
  openApiDocumentResponse,
} from "@app/contracts";
import type { RouteBindings } from "../route-binding.types.js";

/**
 * Provider webhook ingress, health, and the docs surface itself.
 *
 * NOTE ON THE WEBHOOK ROUTES' AUTH. Only the DLR ingress carries a guard; the rest show `none`
 * because each verifies a PROVIDER SIGNATURE inside the handler rather than at the guard layer.
 * That is documented per route below — an unauthenticated-looking route is exactly the thing a
 * reader should be able to check, and "there is no guard" must not be mistaken for "there is no
 * verification".
 */
export const SYSTEM_BINDINGS: RouteBindings = {
  // ---- Delivery reports --------------------------------------------------------------------
  "GET /webhooks/dlr/:provider": {
    summary: "Ingest a delivery report (query form)",
    description:
      "For carriers that call back with a header-less GET (Arkesel sends `?sms_id=..&status=..`), " +
      "so the ingress token is accepted as `?token=`. The owning tenant is resolved from " +
      "`provider_ref` — possession-scoped, never from the payload.",
    tags: ["Webhooks"],
    visibility: "webhook",
    security: ["webhookToken"],
    response: ingestAck,
  },
  "POST /webhooks/dlr/:provider": {
    summary: "Ingest a delivery report (body form)",
    tags: ["Webhooks"],
    visibility: "webhook",
    security: ["webhookToken"],
    response: ingestAck,
  },

  // ---- Provider callbacks (signature-verified in-handler) ----------------------------------
  "GET /webhooks/whatsapp/:provider": {
    summary: "Meta webhook verification handshake",
    description:
      "Meta's subscription challenge. Answers with the echoed challenge when the verify token " +
      "matches; no guard, because Meta controls the handshake shape.",
    tags: ["Webhooks"],
    visibility: "webhook",
    security: ["none"],
    successContentType: "text/plain",
  },
  "POST /webhooks/whatsapp/:provider": {
    summary: "Ingest a WhatsApp event",
    description:
      "Delivery statuses and inbound messages. Authenticated by Meta's payload SIGNATURE inside the " +
      "handler, not by a guard.",
    tags: ["Webhooks"],
    visibility: "webhook",
    security: ["none"],
    response: batchIngestAck,
  },
  "POST /webhooks/paystack": {
    summary: "Ingest a Paystack event",
    description:
      "The source of truth for a cleared payment — a browser redirect never credits a wallet. " +
      "Signature-verified in-handler and idempotent on the provider reference.",
    tags: ["Webhooks"],
    visibility: "webhook",
    security: ["none"],
    response: acceptedAck,
  },
  "POST /webhooks/email/aws-ses": {
    summary: "Ingest an SES event via SNS",
    description:
      "SNS message signature is verified in-handler before the event is trusted.",
    tags: ["Webhooks"],
    visibility: "webhook",
    security: ["none"],
    response: ingestAck,
  },
  "POST /webhooks/workos": {
    summary: "Ingest a WorkOS event",
    description: "Signature-verified in-handler.",
    tags: ["Webhooks"],
    visibility: "webhook",
    security: ["none"],
    response: acceptedAck,
  },

  // ---- Health ------------------------------------------------------------------------------
  "GET /health": {
    summary: "Liveness probe",
    description:
      "Trivial and dependency-free — it must stay green while dependencies are down.",
    tags: ["Health"],
    visibility: "internal",
    security: ["none"],
    response: healthLiveResponse,
  },
  "GET /health/readyz": {
    summary: "Readiness probe",
    description:
      "Checked by the deploy pipeline against the live URL. Does NOT exercise Redis or the queue, " +
      "so a green readyz is not evidence those work.",
    tags: ["Health"],
    visibility: "internal",
    security: ["none"],
    response: healthReadyResponse,
  },

  // ---- The docs surface itself -------------------------------------------------------------
  "GET /docs": {
    summary: "Render the internal API reference",
    tags: ["Health"],
    visibility: "internal",
    security: ["operatorToken"],
    // An HTML page, so it carries a media type rather than a zod contract. Declaring it also keeps
    // the envelope interceptor off it: the binding is authoritative there, and Fastify only stamps
    // the content-type after the interceptor has already decided.
    successContentType: "text/html",
  },
  "GET /docs/openapi.json": {
    summary: "Retrieve the full OpenAPI document",
    description:
      "The raw document, unwrapped. A renderer looks for a top-level `openapi` key, so this is the " +
      "one JSON route that must NOT carry the response envelope.",
    tags: ["Health"],
    visibility: "internal",
    security: ["operatorToken"],
    envelope: false,
    response: openApiDocumentResponse,
  },
};
