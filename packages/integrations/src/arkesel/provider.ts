import type { MessageStatus } from "@app/contracts";
import type {
  CanonicalDlr,
  Creds,
  HealthState,
  IncomingRequest,
  JsonSchema,
  NormalizedMessage,
  ProviderResult,
  RequestContext,
  SmsSenderPlugin,
} from "../plugin.js";
import type { PlatformFaultCause } from "../status.js";
import { PLATFORM_FAULT_CAUSES } from "../status.js";

/**
 * Arkesel SMS adapter (F5.1 / Ghana reseller). Speaks ONLY to Arkesel SMS API v2:
 * `send` → POST /api/v2/sms/send with the `api-key` header; the wallet reserve/commit/refund is the
 * engine's job, not this adapter's. Arkesel bills OUR master account per segment — our own wallet
 * does per-tenant billing on top (aggregator model), so `billableStatuses = ['accepted']` mirrors the
 * honest-billing default (commit when Arkesel acks the submit).
 *
 * SANDBOX SAFETY: `creds.sandbox` (default 'true') sends `sandbox: true` — Arkesel accepts the request
 * but never forwards to the carrier and never bills. Real delivery requires `sandbox: 'false'`, which
 * is a deliberate, human-gated config flip (live SMS is a redline). The engine stays provider-agnostic;
 * this adapter is only selected when SMS_PROVIDER=arkesel.
 *
 * DLR: Arkesel calls the configured `callback_url` with a GET carrying `sms_id` + `status` query params
 * (UNSIGNED — Arkesel requires the URL be auth-exempt). The HTTP ingress normalises those params into
 * `{ sms_id, status }` and hands them to `parseDlr`; possession-scoping on `provider_ref` + the ingress
 * token (not a body signature) are what authenticate the callback, so `verifyWebhook` returns true.
 */
const BASE_URL = "https://sms.arkesel.com/api/v2";
const SUPPORTED_COUNTRIES = new Set(["GH", "NG"]); // West Africa focus (reseller region)

/** Arkesel DLR status vocabulary → our canonical MessageStatus. An unmapped status throws (B1). */
const DLR_STATUS: Record<string, MessageStatus> = {
  DELIVERED: "delivered",
  SUBMITTED: "sent", // handed to the carrier; more advanced than `accepted`, not yet `delivered`
  QUEUED: "queued",
  NOT_DELIVERED: "undelivered",
  EXPIRED: "expired",
  PROHIBITED: "failed", // carrier/route rejection (blocked content, unapproved sender id, …)
};

export class ArkeselError extends Error {}

export class ArkeselSmsProvider implements SmsSenderPlugin {
  readonly slug = "arkesel-sms";
  readonly capability = "sms" as const;
  readonly version = "1.0.0";
  readonly configSchema: JsonSchema = {
    type: "object",
    required: ["apiKey", "senderId"],
    properties: {
      apiKey: { type: "string" },
      senderId: { type: "string" }, // approved sender name (<= 11 chars), e.g. "Fabric"
      sandbox: { type: "string", enum: ["true", "false"] }, // default "true"
      callbackUrl: { type: "string" }, // DLR webhook; omit to skip delivery reports
    },
  };
  // Commit-on-submission-ack (honest billing). Same platform-fault vocabulary as the fake: a failure
  // we caused (mapped onto one of these by the ingress) is never billed to the customer.
  readonly billableStatuses: readonly MessageStatus[] = ["accepted"];
  readonly platformFaultExemptions: readonly PlatformFaultCause[] =
    PLATFORM_FAULT_CAUSES;

  supports(ctx: RequestContext): boolean {
    return (
      !ctx.destinationCountry ||
      SUPPORTED_COUNTRIES.has(ctx.destinationCountry.toUpperCase())
    );
  }

  healthCheck(): Promise<HealthState> {
    // No cheap unauthenticated probe; report up (a real send surfaces auth/balance errors).
    return Promise.resolve({ status: "up" });
  }

  async send(msg: NormalizedMessage, creds: Creds): Promise<ProviderResult> {
    const apiKey = requireCred(creds, "apiKey");
    const sender = requireCred(creds, "senderId");
    const sandbox = creds.sandbox !== "false"; // DEFAULT SANDBOX — live delivery is an explicit flip
    const body: Record<string, unknown> = {
      sender,
      message: msg.body,
      recipients: [toMsisdn(msg.to)],
      sandbox,
      ...(creds.callbackUrl ? { callback_url: creds.callbackUrl } : {}),
    };
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}/sms/send`, {
        method: "POST",
        headers: { "api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      // Network/transport fault — no provider response. THROW so the engine's resolve tx never runs;
      // the message stays `sending` + reserved and BullMQ retries (the send is idempotent per message).
      throw new ArkeselError(
        `Arkesel transport fault: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
    const payload = (await response.json().catch(() => null)) as {
      status?: string;
      message?: string;
      data?: unknown;
    } | null;

    if (!response.ok || payload?.status !== "success") {
      // 402 (insufficient balance), 403 (inactive gateway), 422 (validation) are CLEAN refusals: the
      // provider acked the request and declined it → return `failed` so the engine refunds the
      // reservation now (never bill the customer for our reject). 401/500 are our-config/provider
      // faults → THROW so we retry rather than silently swallow.
      if (response.status === 401 || response.status >= 500) {
        throw new ArkeselError(
          payload?.message ?? `Arkesel send failed (${response.status}).`,
        );
      }
      return { status: "failed", raw: payload };
    }

    const providerRef = extractSmsId(payload.data);
    return {
      status: "accepted",
      ...(providerRef ? { providerRef } : {}),
      raw: payload,
    };
  }

  parseDlr(payload: unknown): CanonicalDlr {
    // The ingress normalises Arkesel's GET query (`?sms_id=..&status=..`) into this object.
    const p = (payload ?? {}) as Record<string, unknown>;
    const providerRef =
      typeof p.sms_id === "string"
        ? p.sms_id
        : typeof p.smsId === "string"
          ? p.smsId
          : "";
    const rawStatus =
      typeof p.status === "string" ? p.status.toUpperCase() : "";
    const status = DLR_STATUS[rawStatus];
    if (!providerRef || !status) {
      // Unmapped/garbage → throw, never silently pass (mirrors the fake + Paystack adapters, B1).
      throw new ArkeselError(
        `Unparseable or unmapped Arkesel DLR (sms_id=${providerRef || "?"}, status=${rawStatus || "?"}).`,
      );
    }
    return { providerRef, status, raw: payload };
  }

  verifyWebhook(_req: IncomingRequest, _creds: Creds): boolean {
    // Arkesel DLR callbacks are UNSIGNED (they require the URL be auth-exempt). Authentication is the
    // ingress token + possession-scoped provider_ref lookup at the HTTP layer, not a body signature.
    return true;
  }
}

function requireCred(creds: Creds, key: string): string {
  const value = creds[key];
  if (!value) throw new ArkeselError(`Arkesel ${key} is required.`);
  return value;
}

/** E.164 (`+233…`) → Arkesel MSISDN (digits only, country code retained). */
function toMsisdn(to: string): string {
  return to.replace(/[^\d]/g, "");
}

/** Pull the per-recipient sms_id from a delivery-webhook send response (`data` is object or array). */
function extractSmsId(data: unknown): string | undefined {
  const first = Array.isArray(data) ? data[0] : data;
  if (!first || typeof first !== "object") return undefined;
  const entry = first as Record<string, unknown>;
  for (const key of ["id", "sms_id", "messageId"]) {
    if (typeof entry[key] === "string") return entry[key] as string;
  }
  return undefined;
}
