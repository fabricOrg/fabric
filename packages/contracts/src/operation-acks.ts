import { z } from "zod";

/**
 * ACKNOWLEDGEMENT SHAPES — the responses that confirm an action rather than return a resource.
 *
 * These were undocumented because they were never DTOs: each handler returned an inline object
 * literal with no contract and, in most cases, no declared return type either. That is fine until
 * someone has to TEST against them, at which point "the endpoint returns something" is not a
 * contract and a transaction cannot be built on it.
 *
 * WRITTEN TO MATCH THE HANDLERS AS THEY ARE, not as they should be. Three different acknowledgement
 * vocabularies exist across the API and this file records all three rather than quietly unifying
 * them — standardising is a BREAKING change for every caller already parsing the current shape, so
 * it needs a decision and a migration, not a silent edit inside a documentation task.
 *
 * The divergence, for whoever takes that decision:
 *   - `{ ok: true }`                                    impersonation start/stop, mark-read
 *   - `{ accepted: true }`                              Paystack, WorkOS
 *   - `{ status, request_id }`                          SMS DLR, SES
 *   - `{ accepted: true, processed, request_id }`       WhatsApp
 */

/** `{ ok: true }` — the action completed; there is nothing to return. */
export const okAck = z.object({ ok: z.literal(true) });
export type OkAck = z.infer<typeof okAck>;

/** `{ accepted: true }` — the event was taken for processing, which may not have happened yet. */
export const acceptedAck = z.object({ accepted: z.literal(true) });
export type AcceptedAck = z.infer<typeof acceptedAck>;

/**
 * Provider ingress acknowledgement carrying our request id. `status` is our ingest outcome, NOT the
 * provider's delivery status — a carrier reading this response learns whether we stored the report,
 * nothing about the message.
 */
export const ingestAck = z.object({
  status: z.string(),
  request_id: z.string(),
});
export type IngestAck = z.infer<typeof ingestAck>;

/** WhatsApp ingress: a batch may carry several events, so the count is part of the acknowledgement. */
export const batchIngestAck = z.object({
  accepted: z.literal(true),
  processed: z.number().int().nonnegative(),
  request_id: z.string(),
});
export type BatchIngestAck = z.infer<typeof batchIngestAck>;

/**
 * What the presented credential resolves to. Used by an integrator to confirm which workspace a key
 * belongs to before sending anything with it — the cheapest way to catch a test key in production.
 */
export const apiContextResponse = z.object({
  tenant_id: z.string(),
  scopes: z.array(z.string()),
  request_id: z.string(),
});
export type ApiContextResponse = z.infer<typeof apiContextResponse>;
