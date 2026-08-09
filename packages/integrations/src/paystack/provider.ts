import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  CanonicalPaymentEvent,
  ChargeAuthorizationRequest,
  ChargeAuthorizationResult,
  ChargeInit,
  ChargeRequest,
  Creds,
  HealthState,
  IncomingRequest,
  JsonSchema,
  PaymentAuthorization,
  PaymentProviderPlugin,
  RequestContext,
} from "../plugin.js";
import { updateWithRawBody } from "../plugin.js";

/**
 * Paystack payment adapter (E4 top-up). Sandbox = the `sk_test_` secret. Speaks ONLY to Paystack:
 * `initCharge` opens a hosted checkout; `verifyWebhook` authenticates the raw callback (HMAC-SHA512
 * over the exact bytes, keyed by the secret); `parseEvent` maps it to canonical form. Crediting the
 * wallet (idempotent on the reference) is the engine's job, not this adapter's.
 *
 * Paystack `amount` is an integer in the currency's minor unit (pesewas/kobo/cents) — the same exact
 * minor units we carry as bigint, so no float ever enters the money path.
 */
const BASE_URL = "https://api.paystack.co";
const SUPPORTED = new Set(["GHS", "NGN", "USD", "ZAR", "KES"]);

export class PaystackError extends Error {}

export class PaystackProvider implements PaymentProviderPlugin {
  readonly slug = "paystack";
  readonly capability = "payment" as const;
  readonly version = "1.0.0";
  readonly configSchema: JsonSchema = {
    type: "object",
    required: ["secretKey"],
    properties: {
      secretKey: { type: "string" },
      publicKey: { type: "string" },
    },
  };

  supports(ctx: RequestContext): boolean {
    return !ctx.currency || SUPPORTED.has(ctx.currency.toUpperCase());
  }

  async healthCheck(): Promise<HealthState> {
    // No unauthenticated health endpoint; report up (a real send surfaces auth/credential errors).
    return { status: "up" };
  }

  async initCharge(req: ChargeRequest, creds: Creds): Promise<ChargeInit> {
    const secretKey = requireSecret(creds);
    const response = await fetch(`${BASE_URL}/transaction/initialize`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secretKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: req.email,
        amount: Number(req.amountMinor), // exact minor units → Paystack subunit
        currency: req.currency.toUpperCase(),
        reference: req.reference,
        ...(req.callbackUrl ? { callback_url: req.callbackUrl } : {}),
        ...(req.metadata ? { metadata: req.metadata } : {}),
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      status?: boolean;
      message?: string;
      data?: {
        authorization_url?: string;
        access_code?: string;
        reference?: string;
      };
    } | null;
    if (!response.ok || !payload?.status || !payload.data?.authorization_url) {
      throw new PaystackError(
        payload?.message ?? `Paystack initialize failed (${response.status}).`,
      );
    }
    return {
      authorizationUrl: payload.data.authorization_url,
      providerRef: payload.data.access_code ?? req.reference,
      reference: payload.data.reference ?? req.reference,
      raw: payload,
    };
  }

  async chargeAuthorization(
    req: ChargeAuthorizationRequest,
    creds: Creds,
  ): Promise<ChargeAuthorizationResult> {
    const secretKey = requireSecret(creds);
    const response = await fetch(
      `${BASE_URL}/transaction/charge_authorization`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${secretKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          authorization_code: req.authorizationCode,
          email: req.email,
          amount: Number(req.amountMinor),
          currency: req.currency.toUpperCase(),
          reference: req.reference,
        }),
      },
    );
    const payload = (await response.json().catch(() => null)) as {
      status?: boolean;
      message?: string;
      data?: { status?: string; id?: number };
    } | null;
    if (!response.ok || !payload?.status) {
      throw new PaystackError(
        payload?.message ?? `Paystack charge failed (${response.status}).`,
      );
    }
    const raw = payload.data?.status;
    return {
      status:
        raw === "success" ? "success" : raw === "failed" ? "failed" : "pending",
      ...(typeof payload.data?.id === "number"
        ? { providerRef: String(payload.data.id) }
        : {}),
      raw: payload,
    };
  }

  async verifyCharge(
    reference: string,
    creds: Creds,
  ): Promise<ChargeAuthorizationResult | null> {
    const response = await fetch(
      `${BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: { authorization: `Bearer ${requireSecret(creds)}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.status === 404) return null;
    const payload = (await response.json().catch(() => null)) as {
      status?: boolean;
      message?: string;
      data?: { status?: string; id?: number; reference?: string };
    } | null;
    if (!response.ok || !payload?.status || !payload.data) {
      throw new PaystackError(
        payload?.message ??
          `Paystack verification failed (${response.status}).`,
      );
    }
    if (payload.data.reference && payload.data.reference !== reference) {
      throw new PaystackError(
        "Paystack verification returned another reference.",
      );
    }
    const status = payload.data.status;
    return {
      status:
        status === "success"
          ? "success"
          : status === "failed"
            ? "failed"
            : "pending",
      ...(typeof payload.data.id === "number"
        ? { providerRef: String(payload.data.id) }
        : {}),
      raw: payload,
    };
  }

  verifyWebhook(req: IncomingRequest, creds: Creds): boolean {
    const secretKey = requireSecret(creds);
    const provided = req.headers["x-paystack-signature"];
    if (!provided) return false;
    const expected = updateWithRawBody(
      createHmac("sha512", secretKey),
      req.rawBody,
    ).digest("hex");
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseEvent(payload: unknown): CanonicalPaymentEvent {
    const event =
      typeof payload === "string"
        ? (JSON.parse(payload) as Record<string, unknown>)
        : (payload as Record<string, unknown>);
    const type = typeof event?.event === "string" ? event.event : "unknown";
    const data = (event?.data ?? {}) as Record<string, unknown>;
    const reference = typeof data.reference === "string" ? data.reference : "";
    if (!reference) {
      throw new PaystackError("Paystack event missing a reference.");
    }
    const rawStatus = typeof data.status === "string" ? data.status : "";
    const status =
      type === "charge.success" || rawStatus === "success"
        ? "success"
        : rawStatus === "failed"
          ? "failed"
          : "pending";
    const authorization = parseAuthorization(data.authorization);
    return {
      type,
      reference,
      status,
      raw: payload,
      ...(typeof data.id === "number" ? { providerRef: String(data.id) } : {}),
      ...(typeof data.amount === "number"
        ? { amountMinor: BigInt(data.amount) }
        : {}),
      ...(typeof data.currency === "string" ? { currency: data.currency } : {}),
      ...(authorization ? { authorization } : {}),
    };
  }
}

function requireSecret(creds: Creds): string {
  const secretKey = creds.secretKey;
  if (!secretKey) throw new PaystackError("Paystack secretKey is required.");
  return secretKey;
}

/** Map Paystack's `data.authorization` into a reusable token (returns undefined if not present). */
function parseAuthorization(value: unknown): PaymentAuthorization | undefined {
  if (!value || typeof value !== "object") return undefined;
  const a = value as Record<string, unknown>;
  const authorizationCode =
    typeof a.authorization_code === "string" ? a.authorization_code : "";
  if (!authorizationCode) return undefined;
  return {
    authorizationCode,
    reusable: a.reusable === true,
    ...(typeof a.card_type === "string" ? { cardType: a.card_type } : {}),
    ...(typeof a.last4 === "string" ? { last4: a.last4 } : {}),
    ...(typeof a.exp_month === "string" ? { expMonth: a.exp_month } : {}),
    ...(typeof a.exp_year === "string" ? { expYear: a.exp_year } : {}),
    ...(typeof a.bank === "string" ? { bank: a.bank } : {}),
  };
}
