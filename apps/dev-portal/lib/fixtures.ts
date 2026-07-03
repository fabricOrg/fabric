// Typed mock data for the dev portal — shapes from @app/contracts, swap to the BFF later with zero
// churn. Full secrets never live here (only prefixes); the once-only secret is minted in mock-api.

import type {
  ApiKey,
  ApiLogDetail,
  ApiLogSummary,
  WebhookEndpoint,
} from "@app/contracts";

export const AVAILABLE_SCOPES: readonly string[] = [
  "sms:send",
  "sms:read",
  "wallet:read",
  "webhooks:manage",
];

export const API_KEYS = [
  {
    id: "key_live_01",
    name: "Production API",
    env: "live",
    prefix: "sk_live_a1b2…",
    scopes: ["sms:send", "wallet:read"],
    status: "active",
    createdAt: "2026-06-14T10:02:00Z",
    lastUsedAt: "2026-07-03T09:40:11Z",
  },
  {
    id: "key_test_01",
    name: "CI sandbox",
    env: "test",
    prefix: "sk_test_c3d4…",
    scopes: ["sms:send", "sms:read"],
    status: "active",
    createdAt: "2026-06-20T14:22:00Z",
    lastUsedAt: "2026-07-03T08:15:03Z",
  },
  {
    id: "key_test_02",
    name: "Old integration",
    env: "test",
    prefix: "sk_test_e5f6…",
    scopes: ["sms:send"],
    status: "revoked",
    createdAt: "2026-05-01T09:00:00Z",
    lastUsedAt: null,
  },
] as const satisfies readonly ApiKey[];

export const WEBHOOK_ENDPOINTS = [
  {
    id: "we_01",
    url: "https://api.kwikgh.com/hooks/fabric",
    events: ["message.delivered", "message.failed"],
    signingSecret: "whsec_7Kd…9Q2",
    status: "active",
    createdAt: "2026-06-21T11:00:00Z",
  },
] as const satisfies readonly WebhookEndpoint[];

export const API_LOGS = [
  {
    id: "log_09",
    method: "POST",
    endpoint: "/v1/sms/send",
    statusCode: 202,
    requestId: "req_8a2f01",
    latencyMs: 142,
    at: "2026-07-03T09:40:11Z",
  },
  {
    id: "log_08",
    method: "GET",
    endpoint: "/v1/messages",
    statusCode: 200,
    requestId: "req_8a2ef0",
    latencyMs: 38,
    at: "2026-07-03T09:38:55Z",
  },
  {
    id: "log_07",
    method: "POST",
    endpoint: "/v1/sms/send",
    statusCode: 402,
    requestId: "req_402ba1",
    latencyMs: 51,
    at: "2026-07-03T09:31:20Z",
  },
  {
    id: "log_06",
    method: "GET",
    endpoint: "/v1/sms/msg_xxx",
    statusCode: 404,
    requestId: "req_404ee9",
    latencyMs: 22,
    at: "2026-07-03T09:12:44Z",
  },
  {
    id: "log_05",
    method: "POST",
    endpoint: "/v1/sms/send",
    statusCode: 429,
    requestId: "req_429aa0",
    latencyMs: 12,
    at: "2026-07-03T09:02:01Z",
  },
] as const satisfies readonly ApiLogSummary[];

export const API_LOG_DETAILS: Readonly<Record<string, ApiLogDetail>> = {
  log_07: {
    id: "log_07",
    method: "POST",
    endpoint: "/v1/sms/send",
    statusCode: 402,
    requestId: "req_402ba1",
    latencyMs: 51,
    at: "2026-07-03T09:31:20Z",
    requestBody:
      '{\n  "to": "+233201234567",\n  "from": "JOJO",\n  "body": "Your OTP is 402913"\n}',
    responseBody:
      '{\n  "error": {\n    "type": "insufficient_funds_error",\n    "code": "insufficient_funds",\n    "message": "Not enough balance to send."\n  },\n  "request_id": "req_402ba1"\n}',
  },
  log_09: {
    id: "log_09",
    method: "POST",
    endpoint: "/v1/sms/send",
    statusCode: 202,
    requestId: "req_8a2f01",
    latencyMs: 142,
    at: "2026-07-03T09:40:11Z",
    requestBody:
      '{\n  "to": "+233241111111",\n  "from": "Fabric",\n  "body": "Welcome to KwikGH"\n}',
    responseBody:
      '{\n  "id": "msg_01H8",\n  "status": "accepted",\n  "segments": 1\n}',
  },
};

export const SAMPLE_ERROR = {
  error: {
    type: "api_error",
    code: "internal_error",
    message: "We couldn't load this right now. Please try again.",
  },
  request_id: "req_3a9f21c7",
} as const;
