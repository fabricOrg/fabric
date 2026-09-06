import type { Transport } from "./transport.js";
import type { FabricResponse, RequestOptions, WriteOptions } from "./types.js";
import {
  enumField,
  numberField,
  requireE164,
  requireNonEmpty,
  stringField,
} from "./validation.js";

const VERIFICATION_STATUSES = [
  "pending",
  "verified",
  "failed",
  "expired",
] as const;

export interface StartVerificationParams {
  readonly to: string;
  readonly senderId?: string;
  /**
   * Stable key of a released, verify-eligible SMS message definition to render instead of the
   * built-in wording. Chosen per call, so one platform can send differently-branded codes for the
   * merchants it resells to. Requires an application-scoped key, which names the environment the
   * definition is released in.
   */
  readonly template?: string;
  /**
   * Values for the template's own variables, passed to the API verbatim — these are the names the
   * template author wrote, not SDK parameters, so they are NOT camelCased on the way out.
   * `code`, `expires_minutes` and `expires_seconds` are supplied by Fabric and are REFUSED here:
   * the verification code is generated server-side and never accepted from a caller.
   */
  readonly variables?: Readonly<Record<string, string | number | boolean>>;
  /** Locale variant to render; falls back to the definition's default locale. */
  readonly locale?: string;
}
export interface StartedVerification {
  readonly id: string;
  readonly status: "pending" | "verified" | "failed" | "expired";
  readonly to: string;
  readonly channel: "sms";
  /** Seconds left at the time of THIS response — recomputed on an idempotent replay, 0 once lapsed. */
  readonly expiresIn: number;
  /** Absolute server expiry. Drive a countdown from this if you cache or replay the response. */
  readonly expiresAt: string;
  readonly debugCode?: string;
}
export interface CheckVerificationParams {
  readonly id: string;
  readonly code: string;
}
export interface CheckedVerification {
  readonly id: string;
  readonly status: "pending" | "verified" | "failed" | "expired";
  readonly verifiedAt: string | null;
}

export class VerifyResource {
  constructor(private readonly transport: Transport) {}

  async start(
    params: StartVerificationParams,
    options?: WriteOptions,
  ): Promise<FabricResponse<StartedVerification>> {
    requireE164(params.to);
    const response = await this.transport.request<Record<string, unknown>>({
      method: "POST",
      path: "/v1/verify",
      body: {
        to: params.to,
        ...(params.senderId ? { sender_id: params.senderId } : {}),
        ...(params.template ? { template: params.template } : {}),
        ...(params.variables ? { variables: params.variables } : {}),
        ...(params.locale ? { locale: params.locale } : {}),
      },
      retryableWrite: options?.idempotencyKey !== undefined,
      ...(options ? { options } : {}),
    });
    return {
      ...response,
      data: {
        id: stringField(response.data.id, "id"),
        status: enumField(
          response.data.status,
          VERIFICATION_STATUSES,
          "status",
        ),
        to: stringField(response.data.to, "to"),
        channel: enumField(response.data.channel, ["sms"] as const, "channel"),
        expiresIn: numberField(response.data.expires_in, "expires_in"),
        expiresAt: stringField(response.data.expires_at, "expires_at"),
        ...(typeof response.data.debug_code === "string"
          ? { debugCode: response.data.debug_code }
          : {}),
      },
    };
  }

  async check(
    params: CheckVerificationParams,
    options?: RequestOptions,
  ): Promise<FabricResponse<CheckedVerification>> {
    requireNonEmpty(params.id, "id");
    requireNonEmpty(params.code, "code");
    const response = await this.transport.request<Record<string, unknown>>({
      method: "POST",
      path: "/v1/verify/check",
      body: params,
      ...(options ? { options } : {}),
    });
    return {
      ...response,
      data: {
        id: stringField(response.data.id, "id"),
        status: enumField(
          response.data.status,
          VERIFICATION_STATUSES,
          "status",
        ),
        verifiedAt:
          response.data.verified_at === null
            ? null
            : stringField(response.data.verified_at, "verified_at"),
      },
    };
  }
}
