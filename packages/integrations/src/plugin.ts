import type { Hmac } from "node:crypto";
import type { MessageStatus } from "@app/contracts";
import type { PlatformFaultCause } from "./status.js";

/**
 * Feed a raw webhook body into an HMAC without guessing at the encoding. Bytes go in untouched; a
 * string is encoded as utf8 exactly once. Calling `.update(rawBody, "utf8")` directly does not
 * type-check against the `string | Uint8Array` union and would need a cast — and a cast is precisely
 * how the wrong branch gets chosen silently on a signature check.
 */
export function updateWithRawBody(
  hmac: Hmac,
  rawBody: string | Uint8Array,
): Hmac {
  return typeof rawBody === "string"
    ? hmac.update(rawBody, "utf8")
    : hmac.update(rawBody);
}

/**
 * The vendor-agnostic plugin contract (F5.1 / INTEGRATIONS §3). A provider = an adapter implementing
 * this interface; removing a vendor = deleting its adapter — nothing else references it, so lock-in is
 * impossible. TRANSPORT-AGNOSTIC on purpose: our own future gateway is SMPP (persistent sessions,
 * async submit_sm/deliver_sm), not HTTP — the adapter encapsulates the transport and maps to the
 * canonical models below, so no HTTP-isms leak into the core.
 */

// ---- Supporting shapes -------------------------------------------------------------------------

/** Opaque per-instance credentials/config (from Secrets Manager in cloud). Never logged. */
export type Creds = Readonly<Record<string, string>>;

/**
 * JSON Schema describing an instance's required config keys — drives the control-plane config UI +
 * validation. Kept structurally loose here (no json-schema lib dep in this contract package).
 */
export type JsonSchema = Record<string, unknown>;

/** Eligibility inputs for `supports()` — routing/selection asks "can this provider handle this?". */
export interface RequestContext {
  readonly destinationCountry?: string; // ISO 3166-1 alpha-2, e.g. 'GH'
  readonly destinationPrefix?: string; // E.164 prefix, for prefix-level routing/anomaly checks
  readonly currency?: string; // ISO 4217, e.g. 'GHS'
  readonly senderId?: string; // requested sender ID (approval/eligibility varies per operator)
}

export type HealthStatus = "up" | "degraded" | "down";
export interface HealthState {
  readonly status: HealthStatus;
  readonly detail?: string;
}

/**
 * Transport-neutral inbound webhook, for `verifyWebhook` (signature over the RAW bytes + headers).
 * `rawBody` is the exact received body (never a re-serialized object) so HMAC verification is stable.
 *
 * PREFER `Uint8Array`. A signature is over BYTES, and a `string` only round-trips losslessly if the
 * ingress decoded it correctly — which is an assumption the adapter cannot check. `string` remains
 * accepted because the Paystack ingress passes one today and rewriting a live payments webhook is not
 * worth the risk here, but any NEW ingress must hand over the real buffer (Fastify exposes it as
 * `request.rawBody`; the app is created with `{ rawBody: true }` in `services/api/src/main.ts`).
 * Build the HMAC input with `updateWithRawBody` rather than calling `.update()` directly, so neither
 * branch can silently pick the wrong encoding.
 */
export interface IncomingRequest {
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody: string | Uint8Array;
}

/**
 * A send-ready message the engine hands to `send()`. `to`/`body` are the REAL values, decrypted
 * just-in-time from the pii_vault for the provider call and never persisted here (the message row
 * references a subject_id surrogate — see privacy schema). `messageId` correlates the later DLR.
 */
export interface NormalizedMessage {
  readonly messageId: string; // our internal id (uuid) — correlates provider ref → DLR
  readonly to: string; // E.164, validated/normalized upstream
  readonly senderId: string; // approved sender ID / from
  readonly body: string; // message text (transient PII)
  readonly encoding: "gsm7" | "ucs2"; // determines segment size (153 / 67 concatenated)
  readonly segments: number; // computed segment count (drives rating)
}

export type WhatsAppTemplateCategory =
  | "authentication"
  | "marketing"
  | "utility";

export interface NormalizedWhatsAppTemplateMessage {
  readonly messageId: string;
  readonly to: string;
  readonly templateName: string;
  readonly templateLanguage: string;
  readonly templateCategory: WhatsAppTemplateCategory;
  readonly variables: readonly string[];
}

export interface WhatsAppTemplateRecord {
  readonly wabaId: string;
  readonly name: string;
  readonly language: string;
  readonly category: string | null;
  readonly status: string;
  readonly qualityRating: string | null;
  readonly components: readonly unknown[];
}

/**
 * Result of a `send()` — the status the provider reports at submit time, and its ref id IF it
 * acknowledged. `providerRef` is OPTIONAL: on a normal accept it's present (the key the DLR arrives
 * under); but when the provider takes the connection without a sync ack (timeout → status stays
 * `sending`, never reaches a billable status), there is no ref yet — that reservation is resolved by
 * the TTL sweeper (F3.3 refund), not a DLR. So `status:'sending'` ⟺ typically no `providerRef`.
 * (Contrast: a message that reaches `accepted` with a ref but whose DLR never arrives → `expired`,
 * and — under `billableStatuses:['accepted']` — stays committed, NOT swept-refunded. That split is
 * the L5 commit/refund branch; see fifi's money-semantics note + CanonicalDlr.)
 */
export interface ProviderResult {
  readonly status: MessageStatus; // initial canonical status: 'accepted' (acked) or 'sending' (no ack yet)
  readonly providerRef?: string; // provider's message id — present once acked; the key the DLR arrives under
  readonly raw?: unknown; // provider's raw response, for audit
}

/** A provider DLR mapped to canonical form (`parseDlr`). Out-of-order tolerant via STATUS_RANK. */
export interface CanonicalDlr {
  readonly providerRef: string; // correlates back to the send's ProviderResult.providerRef
  readonly status: MessageStatus; // mapped canonical status; unmapped raw status → adapter throws
  readonly errorCode?: string; // provider error code, mapped/retained for reporting
  readonly faultCause?: PlatformFaultCause; // set ONLY when the failure is OUR fault → drives refund
  readonly occurredAt?: string; // provider-reported timestamp (ISO 8601), if any
  readonly segments?: number; // actual segments, if the provider reports them (else estimate stands)
  readonly raw?: unknown; // raw DLR payload, for audit
}

// ---- Contracts ---------------------------------------------------------------------------------

/** Generic base — every plugin declares what it is and what it can do. */
export interface PluginManifest {
  readonly slug: string; // 'hubtel-sms', 'fake-sms', 'paystack'
  readonly capability: "sms" | "email" | "payment" | "whatsapp";
  readonly version: string;
  supports(ctx: RequestContext): boolean; // country/currency/sender-id eligibility
  readonly configSchema: JsonSchema;
  healthCheck(): Promise<HealthState>;
}

/**
 * SMS capability contract. `billableStatuses` + `platformFaultExemptions` drive wallet commit/refund
 * timing (the honest-billing model): the engine reserves on send, then COMMITS when the message
 * reaches `billableStatuses[0]` (default `accepted`) — mirroring what the provider bills US — and
 * REFUNDS on a status/fault in `platformFaultExemptions` (never charge for failures we caused) or a
 * non-billable terminal. That DECISION lives in @app/domain + the pipeline (L5); this interface only
 * DECLARES the provider's billing basis. See status.ts + SMS-FEATURES §5.A.
 */
export interface SmsSenderPlugin extends PluginManifest {
  readonly capability: "sms";
  readonly billableStatuses: readonly MessageStatus[]; // statuses this provider charges us for
  readonly platformFaultExemptions: readonly PlatformFaultCause[]; // faults never billed
  send(msg: NormalizedMessage, creds: Creds): Promise<ProviderResult>;
  parseDlr(payload: unknown): CanonicalDlr;
  verifyWebhook(req: IncomingRequest, creds: Creds): boolean;
}

export interface NormalizedEmail {
  readonly messageId: string;
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
  readonly replyTo?: string;
}

export interface EmailProviderResult {
  readonly status: MessageStatus;
  readonly providerRef: string;
  readonly errorCode?: string;
}

export interface EmailSenderPlugin extends PluginManifest {
  readonly capability: "email";
  /** The first provider state at which its upstream cost is incurred. */
  readonly billableStatuses: readonly MessageStatus[];
  send(message: NormalizedEmail, creds: Creds): Promise<EmailProviderResult>;
}

export interface WhatsAppSenderPlugin extends PluginManifest {
  readonly capability: "whatsapp";
  readonly billableStatuses: readonly MessageStatus[];
  send(
    message: NormalizedWhatsAppTemplateMessage,
    creds: Creds,
  ): Promise<ProviderResult>;
  parseDlr(payload: unknown): CanonicalDlr;
  verifyWebhook(req: IncomingRequest, creds: Creds): boolean;
  listTemplates(creds: Creds): Promise<readonly WhatsAppTemplateRecord[]>;
}

// ---- Payment capability (E4 top-up) --------------------------------------------------------------

/** A charge to initialize — collect `amountMinor` (exact minor units) from `email`, keyed by our
 *  idempotent `reference` (e.g. `topup:{uuid}`). `callbackUrl` is where the provider returns the
 *  payer after the hosted checkout. */
export interface ChargeRequest {
  readonly amountMinor: bigint;
  readonly currency: string; // ISO 4217, e.g. 'GHS'
  readonly email: string; // payer email (providers require it)
  readonly reference: string; // OUR idempotency key → maps back to the top-up intent
  readonly callbackUrl?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Result of `initCharge` — the hosted checkout URL to redirect to, plus the provider's ref. */
export interface ChargeInit {
  readonly authorizationUrl: string;
  readonly providerRef: string; // provider's access code / transaction ref
  readonly reference: string; // echoes our reference
  readonly raw?: unknown;
}

export type PaymentEventStatus = "success" | "failed" | "pending";

/** A reusable card token from a successful charge — lets us charge the customer later without them
 *  present (auto top-up). The code is a provider token, NOT the card number. */
export interface PaymentAuthorization {
  readonly authorizationCode: string;
  readonly cardType?: string;
  readonly last4?: string;
  readonly expMonth?: string;
  readonly expYear?: string;
  readonly bank?: string;
  readonly reusable: boolean;
}

/** A provider webhook mapped to canonical form (`parseEvent`). `reference` correlates back to the
 *  top-up intent; `amountMinor`/`currency` are re-verified against the intent before crediting. */
export interface CanonicalPaymentEvent {
  readonly type: string; // provider event name, e.g. 'charge.success'
  readonly reference: string;
  readonly providerRef?: string;
  readonly amountMinor?: bigint;
  readonly currency?: string;
  readonly status: PaymentEventStatus;
  readonly authorization?: PaymentAuthorization; // reusable card token, when the provider returns one
  readonly raw?: unknown;
}

/**
 * Payment capability contract (wallet top-up / collections). Same vendor-agnostic shape as SMS:
 * `initCharge` starts a hosted checkout, `verifyWebhook` authenticates the raw callback, `parseEvent`
 * maps it to canonical form. The wallet credit (idempotent on the reference) is the ENGINE's job, not
 * the adapter's — the adapter only speaks to the provider.
 */
/** Charge a saved authorization with no user present (auto top-up). The credit still arrives via the
 *  webhook (charge.success) — this just triggers it and reports the synchronous status. */
export interface ChargeAuthorizationRequest {
  readonly authorizationCode: string;
  readonly email: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly reference: string;
}

export interface ChargeAuthorizationResult {
  readonly status: PaymentEventStatus;
  readonly providerRef?: string;
  readonly raw?: unknown;
}

export interface PaymentProviderPlugin extends PluginManifest {
  readonly capability: "payment";
  initCharge(req: ChargeRequest, creds: Creds): Promise<ChargeInit>;
  chargeAuthorization(
    req: ChargeAuthorizationRequest,
    creds: Creds,
  ): Promise<ChargeAuthorizationResult>;
  /**
   * Resolve an ambiguous saved-card attempt by its stable reference. Null means the provider has no
   * transaction with that reference, so a durable worker may safely submit it.
   */
  verifyCharge(
    reference: string,
    creds: Creds,
  ): Promise<ChargeAuthorizationResult | null>;
  verifyWebhook(req: IncomingRequest, creds: Creds): boolean;
  parseEvent(payload: unknown): CanonicalPaymentEvent;
}
