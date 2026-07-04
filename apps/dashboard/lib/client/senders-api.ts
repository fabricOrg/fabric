// Client data layer for Sender-ID management (compliance-critical: NG NCC + GH require registered
// sender IDs before delivery). Mirrors the `bffRequest` + `.parse()` boundary-validation pattern in
// lib/client/dashboard-api.ts: every BFF response is validated before it reaches the UI.
//
// NOTE(integrator): the house pattern validates responses with zod schemas imported from
// @app/contracts (see dashboard-api.ts). `zod` is NOT a direct dependency of @app/dashboard and is
// not resolvable from this app under pnpm's strict node-linker (verified: `require.resolve('zod')`
// → MODULE_NOT_FOUND), so a bare `import { z } from "zod"` here would break the build. Until zod is
// wired in, this module ships a dependency-free typed validator with the same contract as
// `schema.parse()` — it returns typed data or throws a shared error envelope on malformed input.
// TODO(BFF): promote these DTOs to @app/contracts (as senders.ts) + wire /v1/senders, then replace
// the hand-rolled validator with `sendersResponse.parse(...)` exactly like wallet/sms.

export type SenderStatus = "active" | "pending" | "rejected";
export type SenderCountry = "NG" | "GH";
export type SenderType = "alphanumeric" | "short-code";

/** A tenant's registered (or in-review) originator. `pending` = under carrier/NCC review
 * (1–5 business days); `rejected` carries a human-readable `note`; `active` = live for sending. */
export interface SenderId {
  readonly id: string;
  readonly senderId: string;
  readonly status: SenderStatus;
  readonly country: SenderCountry;
  readonly type: SenderType;
  readonly useCase: string;
  /** ISO-8601 timestamp of the registration request. */
  readonly submittedAt: string;
  /** Present on `rejected` rows: the carrier/regulator reason. */
  readonly note?: string;
}

export interface RegisterSenderInput {
  readonly senderId: string;
  readonly country: SenderCountry;
  readonly type: SenderType;
  readonly useCase: string;
}

export const SENDER_STATUSES = ["active", "pending", "rejected"] as const;
export const SENDER_COUNTRIES = ["NG", "GH"] as const;
export const SENDER_TYPES = ["alphanumeric", "short-code"] as const;

/** GSM alphanumeric originators are capped at 11 characters by the SMPP spec / carriers. */
export const ALPHANUMERIC_MAX_LEN = 11;

// --- boundary validation (drop-in for zod's `.parse()`) ------------------------------------------

/** Thrown when a BFF response doesn't match the DTO — shaped like the shared API error envelope so
 * `toastApiError` / `parseApiError` (from @app/contracts) render it with a sensible message. */
function invalidResponse(): never {
  throw {
    error: {
      type: "api_error",
      code: "invalid_response",
      message: "The server returned an unexpected response.",
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : invalidResponse();
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[]): T {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : invalidResponse();
}

function parseSenderId(value: unknown): SenderId {
  if (!isRecord(value)) return invalidResponse();
  const { note } = value;
  return {
    id: asString(value.id),
    senderId: asString(value.senderId),
    status: asEnum(value.status, SENDER_STATUSES),
    country: asEnum(value.country, SENDER_COUNTRIES),
    type: asEnum(value.type, SENDER_TYPES),
    useCase: asString(value.useCase),
    submittedAt: asString(value.submittedAt),
    ...(typeof note === "string" && note.length > 0 ? { note } : {}),
  };
}

// --- requests ------------------------------------------------------------------------------------

async function bffRequest(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw payload;
  return payload;
}

/** GET the tenant's sender IDs. */
export async function listSenders(): Promise<SenderId[]> {
  const payload = await bffRequest("/api/dashboard/senders");
  if (!isRecord(payload) || !Array.isArray(payload.senders))
    return invalidResponse();
  return payload.senders.map(parseSenderId);
}

/** POST a registration request. The created sender comes back with `status: "pending"`. */
export async function registerSender(
  input: RegisterSenderInput,
): Promise<SenderId> {
  const payload = await bffRequest("/api/dashboard/senders", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!isRecord(payload)) return invalidResponse();
  return parseSenderId(payload.sender);
}
