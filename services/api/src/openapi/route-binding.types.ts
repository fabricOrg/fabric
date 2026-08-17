import type { ZodType } from "zod";

/**
 * ROUTE BINDINGS — the one hand-maintained part of the OpenAPI pipeline, and the only place the
 * public/internal boundary is written down.
 *
 * WHY THIS EXISTS AT ALL. Schemas come from `@app/contracts` (zod) and the route list comes from
 * Nest's own router, so neither can drift. What no machine can infer is INTENT: whether `/v1/tokens`
 * is an SDK endpoint or a dashboard one, what a route is for, which credential opens it. That
 * judgement lives here, keyed to a route, and the generator FAILS when a route has no entry — so a
 * new controller cannot be silently undocumented.
 *
 * The predecessor (`packages/sdk/scripts/openapi-definitions.mjs`) described paths AND schemas by
 * hand, which made it a second source of truth: it shipped a dead CloudFront `servers` url, omitted
 * the entire WhatsApp channel, and its own README claimed email/batch were "not implemented" while
 * the artifact documented them. Bindings deliberately hold no shapes for that reason.
 */

/**
 * Which artifact a route lands in.
 *
 * `public` — SDK/customer surface, authenticated by `sk_*`. Lands in BOTH the public and full specs.
 * `internal` — BFF, admin and staff surface. Lands ONLY in the full spec, which is never published.
 * `webhook` — provider ingress we RECEIVE (Meta, Arkesel, Paystack, SES/SNS). Documented so the
 *   shapes are reviewable, but it is not a customer-callable API; it lands only in the full spec.
 */
export type RouteVisibility = "public" | "internal" | "webhook";

/**
 * The credential that opens a route. Names match `components.securitySchemes` in the emitted doc.
 * `none` is explicit rather than an omission — an unauthenticated route is a claim worth reviewing,
 * not a field someone forgot.
 */
export type SecurityScheme =
  | "secretKey"
  | "bffInternal"
  | "operatorToken"
  | "tenantToken"
  | "webhookToken"
  | "none";

export interface RouteBinding {
  /** One line, imperative. Becomes `summary`. */
  readonly summary: string;
  /** Optional prose. Explain the WHY or a non-obvious constraint, never restate the summary. */
  readonly description?: string;
  readonly tags: readonly [string, ...string[]];
  readonly visibility: RouteVisibility;
  readonly security: readonly SecurityScheme[];
  /**
   * Request body contract. Serialised with `io: "input"` — the PRE-transform shape, which is what a
   * caller actually sends. Using the output shape here documents values the API would reject.
   */
  readonly request?: ZodType;
  /** Query-string contract. Also `io: "input"`. */
  readonly query?: ZodType;
  /**
   * Success response contract. Serialised with `io: "output"` — the POST-transform shape, which is
   * what a caller actually receives. The asymmetry with `request` is the whole reason these are two
   * fields and not one.
   */
  readonly response?: ZodType;
  /** Success status when it is not 200 (e.g. 201 on create, 202 on accept-for-async). */
  readonly successStatus?: number;
  /**
   * Success media type when the endpoint does NOT return JSON — `text/csv` for a statement export,
   * `text/plain` for a provider challenge echo. Defaults to `application/json`.
   *
   * This exists because the generator silently documented every 2xx as JSON, which made the CSV
   * statement export look like a JSON resource. A caller generating a client from that would parse
   * a spreadsheet as an object.
   */
  readonly successContentType?: string;
  /**
   * Documented failure codes BEYOND the global set every route can return (400/401/429/500).
   * List the ones a caller must branch on — 402 insufficient funds, 409 idempotency conflict.
   */
  readonly errorStatuses?: readonly number[];
  readonly deprecated?: boolean;
}

/**
 * Keyed by `${METHOD} ${path}`, where path is Nest's normalised route including its `:param`
 * segments — e.g. `"POST /v1/sms/messages"`, `"GET /v1/sms/:id"`. The generator builds the same key
 * from the router, so a typo here surfaces as an orphan-binding error rather than a missing doc.
 */
export type RouteBindings = Readonly<Record<string, RouteBinding>>;
