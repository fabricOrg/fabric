import type { Transport } from "./transport.js";
import type {
  FabricResponse,
  IdempotentWriteOptions,
  ListParams,
  Page,
  RequestOptions,
  SendWhatsAppParams,
  SentWhatsAppMessage,
  WhatsAppTemplateCategory,
} from "./types.js";
import {
  ApiShapeError,
  enumField,
  nullableStringField,
  pageQueryString,
  record,
  requireE164,
  requireNonEmpty,
  stringField,
} from "./validation.js";

const MESSAGE_STATUSES = [
  "queued",
  "sending",
  "accepted",
  "sent",
  "delivered",
  "undelivered",
  "failed",
  "expired",
] as const;
const TEMPLATE_CATEGORIES = ["marketing", "utility", "authentication"] as const;

export class WhatsAppResource {
  constructor(private readonly transport: Transport) {}

  async send(
    params: SendWhatsAppParams,
    options: IdempotentWriteOptions,
  ): Promise<FabricResponse<SentWhatsAppMessage>> {
    requireNonEmpty(options?.idempotencyKey ?? "", "idempotencyKey");
    requireE164(params.to);
    requireNonEmpty(params.templateName, "templateName");
    requireNonEmpty(params.templateLanguage, "templateLanguage");
    validateTemplateCategory(params.templateCategory);
    const response = await this.transport.request<Record<string, unknown>>({
      method: "POST",
      path: "/v1/whatsapp/messages",
      body: {
        to: params.to,
        template_name: params.templateName,
        template_language: params.templateLanguage,
        template_category: params.templateCategory,
        variables: params.variables ?? [],
        currency: params.currency ?? "GHS",
      },
      retryableWrite: true,
      options,
    });
    return { ...response, data: whatsappMessage(response.data) };
  }

  async retrieve(
    id: string,
    options?: RequestOptions,
  ): Promise<FabricResponse<SentWhatsAppMessage>> {
    requireNonEmpty(id, "id");
    const response = await this.transport.request<Record<string, unknown>>({
      method: "GET",
      path: `/v1/whatsapp/messages/${encodeURIComponent(id)}`,
      ...(options ? { options } : {}),
    });
    return {
      ...response,
      data: whatsappMessage(record(response.data.message)),
    };
  }

  /** @deprecated Use {@link retrieve}; retained for beta compatibility. */
  async get(
    id: string,
    options?: RequestOptions,
  ): Promise<FabricResponse<SentWhatsAppMessage>> {
    return this.retrieve(id, options);
  }

  async list(
    params?: ListParams,
    options?: RequestOptions,
  ): Promise<FabricResponse<Page<SentWhatsAppMessage>>> {
    const response = await this.transport.request<Record<string, unknown>>({
      method: "GET",
      path: `/v1/whatsapp/messages${pageQueryString(params)}`,
      ...(options ? { options } : {}),
    });
    if (!Array.isArray(response.data.messages)) {
      throw new ApiShapeError("messages");
    }
    return {
      ...response,
      data: {
        items: response.data.messages.map((item) =>
          whatsappMessage(record(item)),
        ),
        nextCursor: nullableStringField(
          response.data.next_cursor,
          "next_cursor",
        ),
      },
    };
  }

  async *iterate(
    params?: Pick<ListParams, "limit">,
    options?: RequestOptions,
  ): AsyncGenerator<SentWhatsAppMessage, void, undefined> {
    let cursor: string | undefined;
    do {
      const page = await this.list(
        {
          ...(params?.limit ? { limit: params.limit } : {}),
          ...(cursor ? { cursor } : {}),
        },
        options,
      );
      yield* page.data.items;
      const next = page.data.nextCursor ?? undefined;
      cursor = next === cursor ? undefined : next;
    } while (cursor);
  }
}

function whatsappMessage(data: Record<string, unknown>): SentWhatsAppMessage {
  return {
    id: stringField(data.id, "id"),
    status: enumField(data.status, MESSAGE_STATUSES, "status"),
    // The API returns a masked recipient here (for example, +233***89), not the original E.164 value.
    to: stringField(data.to, "to"),
    provider: stringField(data.provider, "provider"),
    templateName: nullableStringField(data.template_name, "template_name"),
    templateLanguage: nullableStringField(
      data.template_language,
      "template_language",
    ),
    templateCategory: nullableTemplateCategory(
      data.template_category,
      "template_category",
    ),
    cost: money(record(data.cost)),
    createdAt: stringField(data.created_at, "created_at"),
    errorCode: nullableStringField(data.error_code, "error_code"),
  };
}

function money(data: Record<string, unknown>): SentWhatsAppMessage["cost"] {
  return {
    minor: stringField(data.minor, "cost.minor"),
    currency: enumField(
      data.currency,
      ["GHS", "NGN", "USD"] as const,
      "cost.currency",
    ),
  };
}

function nullableTemplateCategory(
  value: unknown,
  name: string,
): WhatsAppTemplateCategory | null {
  if (value === null) return null;
  return enumField(value, TEMPLATE_CATEGORIES, name);
}

function validateTemplateCategory(value: WhatsAppTemplateCategory): void {
  if (!TEMPLATE_CATEGORIES.includes(value)) {
    throw new TypeError(
      "`templateCategory` must be one of marketing, utility, or authentication.",
    );
  }
}
