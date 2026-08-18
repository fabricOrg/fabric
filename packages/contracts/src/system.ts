import { z } from "zod";

/**
 * The operational surface: probes and the documentation endpoint.
 *
 * These had no contracts, and the omission was invisible because the coverage figure was quoted as
 * "129 of 129 endpoints that return a body" — a denominator computed from the endpoints that had
 * schemas, so it could never be anything but complete. Counted honestly it was 129 of 133, and one
 * of the four gaps is `/health/readyz`, the endpoint the deploy pipeline polls as its proof that a
 * release is live. The probe that decides whether a deploy succeeded is a poor place to have an
 * unchecked shape.
 */

/** Liveness. Deliberately dependency-free — it must stay green while dependencies are down. */
export const healthLiveResponse = z.object({
  status: z.literal("ok"),
});
export type HealthLiveResponse = z.infer<typeof healthLiveResponse>;

/**
 * Readiness. `db: "up"` is the only dependency it asserts — Redis and the queue are NOT exercised,
 * so a green readyz is not evidence those work. A failing check answers 503 carrying the standard
 * error envelope with `code: "not_ready"`, which the binding documents; it used to answer 503 with
 * an ad-hoc `{ status, db }` object that appeared in no schema.
 */
export const healthReadyResponse = z.object({
  status: z.literal("ok"),
  db: z.literal("up"),
});
export type HealthReadyResponse = z.infer<typeof healthReadyResponse>;

/**
 * The OpenAPI document served at `/docs/openapi.json`.
 *
 * Loose ON PURPOSE, and this is the one place where that is the honest shape: the payload is an
 * arbitrary OpenAPI 3.1 document whose structure is fixed by that specification, not by us. Writing
 * a hand-made schema for it would be inventing a shape to fill a gap, which is the failure this
 * pipeline replaced. What is worth asserting is the part a renderer depends on — a top-level
 * `openapi` version string — so that is asserted and the rest passes through.
 */
export const openApiDocumentResponse = z
  .object({ openapi: z.string() })
  .catchall(z.unknown());
export type OpenApiDocumentResponse = z.infer<typeof openApiDocumentResponse>;
