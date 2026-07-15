// Dev-portal public API shapes (F8.6 / F2.3) — API keys, webhook endpoints, request logs. Consumed
// by the dev-portal UI + SDK. zod-only, browser-safe. Secrets are shown ONCE at creation and never
// returned again (only the prefix persists).

import { z } from "zod";

// ── API keys ────────────────────────────────────────────────────────────────────────────────────

/** test = sandbox (never charges/sends) · live = real money/delivery. Must be visually unmistakable. */
export const apiKeyEnv = z.enum(["test", "live"]);
export type ApiKeyEnv = z.infer<typeof apiKeyEnv>;

export const apiKeyStatus = z.enum(["active", "revoked"]);
export type ApiKeyStatus = z.infer<typeof apiKeyStatus>;

/** Closed catalog of permissions enforced by today's public data-plane endpoints. */
export const apiKeyScopeValues = [
  "sms:send",
  "sms:read",
  "wallet:read",
  "request_logs:read",
  "api_keys:read",
  "api_keys:write",
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

export const createApiKeyRequest = z.object({
  name: z.string().min(1),
  env: apiKeyEnv,
  scopes: apiKeyScopes,
});
export type CreateApiKeyRequest = z.infer<typeof createApiKeyRequest>;

/** Create response — the ONLY time the full `secret` is returned (once-only reveal). */
export const createApiKeyResult = z.object({
  key: apiKey,
  secret: z.string(), // full sk_test_/sk_live_… — show once, never persisted client-side
});
export type CreateApiKeyResult = z.infer<typeof createApiKeyResult>;

// ── Webhooks ────────────────────────────────────────────────────────────────────────────────────

export const webhookEventType = z.enum([
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
