// Dev-portal public API shapes (F8.6 / F2.3) — API keys, webhook endpoints, request logs. Consumed
// by the dev-portal UI + SDK. zod-only, browser-safe. Secrets are shown ONCE at creation and never
// returned again (only the prefix persists).

import { z } from "zod";

// ── API keys ────────────────────────────────────────────────────────────────────────────────────

/** Sandbox never charges/sends; live can spend money and contact real recipients. */
export const apiKeyEnv = z.enum(["sandbox", "live"]);
export type ApiKeyEnv = z.infer<typeof apiKeyEnv>;

export const apiKeyStatus = z.enum(["active", "revoked"]);
export type ApiKeyStatus = z.infer<typeof apiKeyStatus>;

/** Closed catalog of permissions enforced by today's public data-plane endpoints. */
export const apiKeyScopeValues = [
  "sms:send",
  "sms:read",
  "email:send",
  "email:read",
  "whatsapp:send",
  "wallet:read",
  "request_logs:read",
  "api_keys:read",
  "api_keys:write",
  "definitions:read",
  "messages:send",
  "messages:read",
] as const;
export const apiKeyScope = z.enum(apiKeyScopeValues);
export type ApiKeyScope = z.infer<typeof apiKeyScope>;
export const apiKeyScopes = z.array(apiKeyScope).min(1);

/** A key as listed — the full secret is NEVER here, only the display prefix (e.g. "sk_test_ab3d…"). */
export const apiKey = z.object({
  id: z.string(),
  name: z.string(),
  env: apiKeyEnv,
  prefix: z.string(), // "sk_test_ab3d…"
  scopes: z.array(z.string()),
  status: apiKeyStatus,
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  // Optional expiry (ISO string) — absent/null = never expires. Optional so older callers/fixtures
  // that predate expiry still parse.
  expiresAt: z.string().nullable().optional(),
});
export type ApiKey = z.infer<typeof apiKey>;

/**
 * Create-key body. Previously this covered only name/env/scopes while the endpoint also accepted
 * `application_id`, `expires_in_days` and `tenantId` — so the handler bypassed it entirely and
 * hand-parsed `(body ?? {}) as Record<string, unknown>`. A credential-minting route with an
 * unchecked cast at the boundary is the defect; the incomplete contract was its cause.
 */
/**
 * Hex-shaped UUID, NOT `z.uuid()`. zod 4's `.uuid()` enforces the RFC 4122 version and variant
 * nibbles; Postgres `uuid` accepts any hex in this shape, and this codebase's own fixtures and some
 * seeded ids are not version-4. Validating more strictly than the column would reject identifiers
 * the database issued and stores happily.
 */
const UUID_SHAPE = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "must be a uuid",
  );

export const createApiKeyRequest = z.object({
  name: z.string().min(1),
  env: apiKeyEnv,
  scopes: apiKeyScopes,
  /** ADR-0004: which application's environment mints the key. Omit for the workspace default. */
  application_id: UUID_SHAPE.optional(),
  /** Omit for a key that never expires. */
  expires_in_days: z.number().int().positive().optional(),
  /**
   * OPERATOR PATH ONLY. A tenant-authenticated caller's tenant comes from its credential and this
   * field is ignored — it exists so staff tooling can mint into a named workspace.
   *
   * `.describe()` and not just a JSDoc comment: the comment does not survive `z.toJSONSchema`, so
   * the CUSTOMER artifact published a bare uuid named `tenantId` on the credential-minting route
   * with no explanation at all. A reader concludes they can mint a key into any workspace by id.
   * The same "accuracy to the wrong audience" argument that strips `operatorToken` from this exact
   * operation applies to its body, and stripping the scheme while leaving this was half a fix.
   */
  tenantId: UUID_SHAPE.optional().describe(
    "Operator tooling only. Ignored for API-key and session callers, whose workspace comes from their credential.",
  ),
});
export type CreateApiKeyRequest = z.infer<typeof createApiKeyRequest>;

/** Create response — the ONLY time the full `secret` is returned (once-only reveal). */
export const createApiKeyResult = z.object({
  key: apiKey,
  secret: z.string(), // full sk_test_/sk_live_… — show once, never persisted client-side
});
export type CreateApiKeyResult = z.infer<typeof createApiKeyResult>;

/**
 * List response. Was a BARE ARRAY while every sibling list returns an envelope carrying
 * `request_id` — so this one endpoint could not be correlated in support, and a client generated
 * from the spec had a different shape here than everywhere else. Breaking, pre-prod, §11.
 */
export const listApiKeysResponse = z.object({
  keys: z.array(apiKey),
  request_id: z.string(),
});
export type ListApiKeysResponse = z.infer<typeof listApiKeysResponse>;

// ── Webhooks ────────────────────────────────────────────────────────────────────────────────────

export const webhookEventType = z.enum([
  "message.accepted",
  "message.sent",
  "message.delivered",
  "message.undelivered",
  "message.failed",
  "message.inbound",
]);
export type WebhookEventType = z.infer<typeof webhookEventType>;

export const webhookEndpoint = z.object({
  id: z.string(),
  url: z.string(),
  events: z.array(webhookEventType),
  signingSecret: z.string(), // whsec_…
  status: z.enum(["active", "disabled"]),
  createdAt: z.string(),
});
export type WebhookEndpoint = z.infer<typeof webhookEndpoint>;

// ── Request logs ────────────────────────────────────────────────────────────────────────────────

export const httpMethod = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
export type HttpMethod = z.infer<typeof httpMethod>;

export const apiLogSummary = z.object({
  id: z.string(),
  method: httpMethod,
  endpoint: z.string(),
  statusCode: z.number().int(),
  requestId: z.string(), // req_… — ties back to error toasts elsewhere
  latencyMs: z.number().int().nonnegative(),
  at: z.string(),
});
export type ApiLogSummary = z.infer<typeof apiLogSummary>;

export const apiLogDetail = apiLogSummary.extend({
  requestBody: z.string().nullable(),
  responseBody: z.string().nullable(),
});
export type ApiLogDetail = z.infer<typeof apiLogDetail>;
