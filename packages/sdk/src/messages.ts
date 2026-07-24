import type {
  CatalogMessageKey,
  CatalogPreviewOptions,
  DefinitionCatalog,
  UngeneratedCatalog,
} from "./catalog.js";
import { parseMessageDelivery } from "./message-delivery.js";
import type { Transport } from "./transport.js";
import type {
  EmailPreview,
  FabricResponse,
  IdempotentWriteOptions,
  MessageDelivery,
  MessagePreview,
  RequestOptions,
  SmsPreview,
} from "./types.js";
import {
  booleanField,
  enumField,
  numberField,
  record,
  requireNonEmpty,
  requireRecipient,
  stringField,
} from "./validation.js";

export interface PreviewMessageOptions extends RequestOptions {
  /** Variables for the definition's schema; validated server-side, rendered without side effects. */
  readonly data?: Record<string, unknown>;
  /** Pricing currency (ISO-4217). Defaults to the workspace currency server-side. */
  readonly currency?: string;
  /** Optional E.164 recipient for sender, consent, and quiet-hour eligibility checks. */
  readonly to?: string;
  /** Optional released locale; the definition's default is used when omitted. */
  readonly locale?: string;
  /**
   * Optional assertion of the definition's channel. With a generated catalog this is narrowed to the
   * key's released channel, so a mismatched literal fails to compile; the server rejects a mismatch.
   */
  readonly channel?: "sms" | "email";
}

export interface SendMessageOptions extends IdempotentWriteOptions {
  /** Recipient: an E.164 number for an SMS definition, or an email address for an Email one. */
  readonly to: string;
  /** Variables for the definition's schema; a validation failure fails the send before any charge. */
  readonly data?: Record<string, unknown>;
  /** Optional released locale; the definition's default is used when omitted. */
  readonly locale?: string;
  /**
   * Optional assertion of the definition's channel. With a generated catalog this is narrowed to the
   * key's released channel, so a mismatched literal fails to compile; the server rejects a mismatch.
   */
  readonly channel?: "sms" | "email";
  /** Pricing currency (ISO-4217). Defaults to GHS server-side. */
  readonly currency?: string;
  /** Caller correlation id surfaced on the delivery. */
  readonly reference?: string;
  /** Flat key/value annotations stored on the delivery (max 4KB serialized). */
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  /** Fail closed (before any send or charge) if the rendered message would cost more than this. */
  readonly maxCost?: { readonly minor: string; readonly currency: string };
}

/**
 * Managed messages. `preview` renders a released definition by stable key through the same engine a
 * send uses — no send, charge, or persistence. Blockers (validation/render errors) carry a field path
 * and code, never a value. `send` executes that same render as a durable delivery: the required
 * `idempotencyKey` makes retries safe — an identical replay returns the same delivery resource.
 */
export class MessagesResource<
  Catalog extends DefinitionCatalog = UngeneratedCatalog,
> {
  constructor(private readonly transport: Transport) {}

  async preview<Key extends CatalogMessageKey<Catalog>>(
    key: Key,
    ...args: Catalog["generated"] extends true
      ? [options: CatalogPreviewOptions<Catalog, Key, PreviewMessageOptions>]
      : [options?: PreviewMessageOptions]
  ): Promise<FabricResponse<MessagePreview>> {
    const options = args[0];
    requireNonEmpty(key, "key");
    const data = options?.data;
    const currency = options?.currency;
    const to = options?.to;
    const locale = options?.locale;
    const channel = options?.channel;
    const requestOptions: RequestOptions = {
      ...(options?.signal ? { signal: options.signal } : {}),
      ...(options?.timeout !== undefined ? { timeout: options.timeout } : {}),
      ...(options?.headers ? { headers: options.headers } : {}),
    };
    const response = await this.transport.request<Record<string, unknown>>({
      method: "POST",
      path: "/v1/messages/preview",
      body: {
        key,
        ...(data ? { data } : {}),
        ...(currency ? { currency } : {}),
        ...(to ? { to } : {}),
        ...(locale ? { locale } : {}),
        ...(channel ? { channel } : {}),
      },
      ...(Object.keys(requestOptions).length > 0
        ? { options: requestOptions }
        : {}),
    });
    return { ...response, data: parsePreview(response.data) };
  }

  async send<Key extends CatalogMessageKey<Catalog>>(
    key: Key,
    ...args: Catalog["generated"] extends true
      ? [options: CatalogPreviewOptions<Catalog, Key, SendMessageOptions>]
      : [options: SendMessageOptions]
  ): Promise<FabricResponse<MessageDelivery>> {
    const options = args[0];
    requireNonEmpty(key, "key");
    requireRecipient(options.to);
    requireNonEmpty(options.idempotencyKey, "idempotencyKey");
    const response = await this.transport.request<Record<string, unknown>>({
      method: "POST",
      path: "/v1/message-deliveries",
      body: {
        key,
        to: options.to,
        ...(options.data ? { data: options.data } : {}),
        ...(options.locale ? { locale: options.locale } : {}),
        ...(options.channel ? { channel: options.channel } : {}),
        ...(options.currency ? { currency: options.currency } : {}),
        ...(options.reference ? { reference: options.reference } : {}),
        ...(options.metadata ? { metadata: options.metadata } : {}),
        ...(options.maxCost ? { limits: { max_cost: options.maxCost } } : {}),
      },
      options: {
        idempotencyKey: options.idempotencyKey,
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
        ...(options.headers ? { headers: options.headers } : {}),
      },
    });
    return {
      ...response,
      data: parseMessageDelivery(record(response.data.delivery)),
    };
  }

  async retrieveDelivery(
    id: string,
    options?: RequestOptions,
  ): Promise<FabricResponse<MessageDelivery>> {
    requireNonEmpty(id, "id");
    const response = await this.transport.request<Record<string, unknown>>({
      method: "GET",
      path: `/v1/message-deliveries/${encodeURIComponent(id)}`,
      ...(options ? { options } : {}),
    });
    return {
      ...response,
      data: parseMessageDelivery(record(response.data.delivery)),
    };
  }
}

function parsePreview(data: Record<string, unknown>): MessagePreview {
  const rawBlockers = Array.isArray(data.blockers) ? data.blockers : [];
  const rawWarnings = Array.isArray(data.warnings) ? data.warnings : [];
  const sender = record(data.sender);
  const previewValue = data.preview;
  const emailPreviewValue = data.email_preview;
  return {
    versionId: stringField(data.version_id, "version_id"),
    channel: enumField(data.channel, ["sms", "email"], "channel"),
    environment: enumField(
      data.environment,
      ["sandbox", "live"],
      "environment",
    ),
    resolvedLocale: stringField(data.resolved_locale, "resolved_locale"),
    blockers: rawBlockers.map((b) => {
      const blocker = record(b);
      return {
        path: stringField(blocker.path, "path"),
        code: stringField(blocker.code, "code"),
      };
    }),
    warnings: rawWarnings.map((item) => {
      const warning = record(item);
      return {
        path: stringField(warning.path, "path"),
        code: stringField(warning.code, "code"),
      };
    }),
    eligible: booleanField(data.eligible, "eligible"),
    sender: {
      senderId: stringField(sender.sender_id, "sender.sender_id"),
      status: enumField(
        sender.status,
        [
          "sandbox",
          "active",
          "pending",
          "rejected",
          "unregistered",
          "not_evaluated",
        ],
        "sender.status",
      ),
    },
    messageClass: enumField(
      data.message_class,
      ["transactional", "promotional"],
      "message_class",
    ),
    preview:
      previewValue == null ? null : parseSmsPreview(record(previewValue)),
    emailPreview:
      emailPreviewValue == null
        ? null
        : parseEmailPreview(record(emailPreviewValue)),
  };
}

function parseSmsPreview(data: Record<string, unknown>): SmsPreview {
  return {
    body: stringField(data.body, "body"),
    encoding: enumField(data.encoding, ["gsm7", "ucs2"], "encoding"),
    length: numberField(data.length, "length"),
    segments: numberField(data.segments, "segments"),
    costMinor: stringField(data.cost_minor, "cost_minor"),
    currency: stringField(data.currency, "currency"),
  };
}

function parseEmailPreview(data: Record<string, unknown>): EmailPreview {
  return {
    subject: stringField(data.subject, "email_preview.subject"),
    text: typeof data.text === "string" ? data.text : null,
    html: typeof data.html === "string" ? data.html : null,
    sizeBytes: numberField(data.size_bytes, "email_preview.size_bytes"),
    tier: enumField(
      data.tier,
      ["standard", "large", "xlarge"],
      "email_preview.tier",
    ),
    costMinor: stringField(data.cost_minor, "email_preview.cost_minor"),
    currency: stringField(data.currency, "email_preview.currency"),
  };
}
