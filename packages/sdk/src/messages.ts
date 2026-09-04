import type {
  CatalogMessageKey,
  CatalogPreviewOptions,
  DefinitionCatalog,
  UngeneratedCatalog,
} from "./catalog.js";
import { parseMessageDelivery } from "./message-delivery.js";
import {
  iterateMessageDeliveries,
  listMessageDeliveries,
  listMessageDeliveryWebhooks,
} from "./message-delivery-reads.js";
import type {
  PreviewMessageOptions,
  SendMessageOptions,
} from "./message-options.js";

export type {
  PreviewMessageOptions,
  SendMessageOptions,
} from "./message-options.js";

import type { Transport } from "./transport.js";
import type {
  EmailPreview,
  FabricResponse,
  ListParams,
  MessageDelivery,
  MessageDeliverySummary,
  MessageDeliveryWebhookStatus,
  MessagePreview,
  Page,
  RequestOptions,
  SmsPreview,
  WhatsappPreview,
} from "./types.js";
import {
  ApiShapeError,
  booleanField,
  enumField,
  nullableStringField,
  numberField,
  record,
  requireNonEmpty,
  requireRecipient,
  stringField,
} from "./validation.js";

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
      retryableWrite: true,
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

  async listDeliveries(
    params?: ListParams,
    options?: RequestOptions,
  ): Promise<FabricResponse<Page<MessageDeliverySummary>>> {
    return listMessageDeliveries(this.transport, params, options);
  }

  /** Walk all managed deliveries page by page. */
  async *iterateDeliveries(
    params?: Pick<ListParams, "limit">,
    options?: RequestOptions,
  ): AsyncGenerator<MessageDeliverySummary, void, undefined> {
    yield* iterateMessageDeliveries(this.transport, params, options);
  }

  async listDeliveryWebhooks(
    id: string,
    options?: RequestOptions,
  ): Promise<FabricResponse<ReadonlyArray<MessageDeliveryWebhookStatus>>> {
    return listMessageDeliveryWebhooks(this.transport, id, options);
  }
}

function parsePreview(data: Record<string, unknown>): MessagePreview {
  if (!Array.isArray(data.blockers)) throw new ApiShapeError("blockers");
  if (!Array.isArray(data.warnings)) throw new ApiShapeError("warnings");
  const rawBlockers = data.blockers;
  const rawWarnings = data.warnings;
  const sender = record(data.sender);
  const previewValue = data.preview;
  const emailPreviewValue = data.email_preview;
  const whatsappPreviewValue = data.whatsapp_preview;
  return {
    versionId: stringField(data.version_id, "version_id"),
    channel: enumField(data.channel, ["sms", "email", "whatsapp"], "channel"),
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
    whatsappPreview:
      whatsappPreviewValue == null
        ? null
        : parseWhatsappPreview(record(whatsappPreviewValue)),
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

function parseWhatsappPreview(data: Record<string, unknown>): WhatsappPreview {
  if (!Array.isArray(data.parameters))
    throw new ApiShapeError("whatsapp_preview.parameters");
  const rawParameters = data.parameters;
  return {
    templateName: stringField(
      data.template_name,
      "whatsapp_preview.template_name",
    ),
    templateLanguage: stringField(
      data.template_language,
      "whatsapp_preview.template_language",
    ),
    templateCategory: enumField(
      data.template_category,
      ["marketing", "utility", "authentication"],
      "whatsapp_preview.template_category",
    ),
    // Order preserved verbatim — reordering here would silently reassign values to placeholders.
    parameters: rawParameters.map((value, index) =>
      stringField(value, `whatsapp_preview.parameters.${index}`),
    ),
    costMinor: stringField(data.cost_minor, "whatsapp_preview.cost_minor"),
    currency: stringField(data.currency, "whatsapp_preview.currency"),
  };
}

function parseEmailPreview(data: Record<string, unknown>): EmailPreview {
  return {
    subject: stringField(data.subject, "email_preview.subject"),
    text: nullableStringField(data.text, "email_preview.text"),
    html: nullableStringField(data.html, "email_preview.html"),
    sizeBytes: numberField(data.size_bytes, "email_preview.size_bytes"),
    costMinor: stringField(data.cost_minor, "email_preview.cost_minor"),
    currency: stringField(data.currency, "email_preview.currency"),
  };
}
