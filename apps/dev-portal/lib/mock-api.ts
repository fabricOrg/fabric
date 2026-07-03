// Mock data layer for the dev portal — same async shape the BFF will have (Promise<DTO>, rejects
// with an F8.3 envelope). Each call takes a `scenario` to demo the 4 states. Swap bodies for fetch()
// later; signatures hold. The once-only secret is minted here and returned exactly once.

import type {
  ApiKey,
  ApiLogDetail,
  ApiLogSummary,
  CreateApiKeyRequest,
  CreateApiKeyResult,
  WebhookEndpoint,
} from "@app/contracts";
import {
  API_KEYS,
  API_LOG_DETAILS,
  API_LOGS,
  SAMPLE_ERROR,
  WEBHOOK_ENDPOINTS,
} from "./fixtures";

export type Scenario = "populated" | "empty" | "error";

const LATENCY_MS = 500;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}
function fail(envelope: unknown): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(envelope), LATENCY_MS),
  );
}

export function listApiKeys(
  scenario: Scenario = "populated",
): Promise<readonly ApiKey[]> {
  if (scenario === "error") return fail(SAMPLE_ERROR);
  return delay(scenario === "empty" ? [] : API_KEYS);
}

/** Mints the full secret ONCE (client-side). The persisted record keeps only the prefix. */
export function createApiKey(
  req: CreateApiKeyRequest,
): Promise<CreateApiKeyResult> {
  const rand = crypto.randomUUID().replace(/-/g, "");
  const secret = `sk_${req.env}_${rand}`;
  const prefix = `${secret.slice(0, 12)}…`;
  const key: ApiKey = {
    id: `key_${req.env}_${rand.slice(0, 6)}`,
    name: req.name,
    env: req.env,
    prefix,
    scopes: req.scopes,
    status: "active",
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };
  return delay({ key, secret });
}

export function revokeApiKey(id: string): Promise<{ id: string }> {
  return delay({ id });
}

export function listWebhooks(
  scenario: Scenario = "populated",
): Promise<readonly WebhookEndpoint[]> {
  if (scenario === "error") return fail(SAMPLE_ERROR);
  return delay(scenario === "empty" ? [] : WEBHOOK_ENDPOINTS);
}

/** Fires a sample event to a REGISTERED endpoint only (caller picks from the list, never free-form). */
export function testWebhook(
  endpointId: string,
  event: string,
): Promise<{ statusCode: number }> {
  if (!WEBHOOK_ENDPOINTS.some((e) => e.id === endpointId))
    return fail(SAMPLE_ERROR);
  void event;
  return delay({ statusCode: 200 });
}

export function listLogs(
  scenario: Scenario = "populated",
): Promise<readonly ApiLogSummary[]> {
  if (scenario === "error") return fail(SAMPLE_ERROR);
  return delay(scenario === "empty" ? [] : API_LOGS);
}

export function getLog(id: string): Promise<ApiLogDetail> {
  const found = API_LOG_DETAILS[id];
  if (!found) return fail(SAMPLE_ERROR);
  return delay(found);
}

/** The developer's test key for inlining into docs — fetched fresh per session, NEVER cached. */
export function getInlineTestKey(): Promise<string> {
  const test = API_KEYS.find((k) => k.env === "test" && k.status === "active");
  return delay(test ? test.prefix.replace("…", "xxxx") : "sk_test_your_key");
}
