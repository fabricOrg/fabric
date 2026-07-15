import type { Transport } from "./transport.js";
import type {
  EmailMessage,
  FabricResponse,
  RequestOptions,
  SendEmailParams,
  WriteOptions,
} from "./types.js";
import {
  ApiShapeError,
  enumField,
  record,
  requireNonEmpty,
  stringField,
} from "./validation.js";

const STATUSES = [
  "queued",
  "sending",
  "accepted",
  "sent",
  "delivered",
  "undelivered",
  "failed",
  "expired",
] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class EmailResource {
  constructor(private readonly transport: Transport) {}

  async send(
    params: SendEmailParams,
    options?: WriteOptions,
  ): Promise<FabricResponse<{ id: string; status: EmailMessage["status"] }>> {
    validateEmail(params.to, "to");
    validateEmail(params.from, "from");
    requireNonEmpty(params.subject, "subject");
    if (!params.text && !params.html) {
      throw new TypeError("Provide at least one of `text` or `html`.");
    }
    const response = await this.transport.request<Record<string, unknown>>({
      method: "POST",
      path: "/v1/email/messages",
      body: {
        to: params.to,
        from: params.from,
        subject: params.subject,
        ...(params.text ? { text: params.text } : {}),
        ...(params.html ? { html: params.html } : {}),
        ...(params.replyTo ? { reply_to: params.replyTo } : {}),
      },
      ...(options ? { options } : {}),
    });
    return {
      ...response,
      data: {
        id: stringField(response.data.id, "id"),
        status: enumField(response.data.status, STATUSES, "status"),
      },
    };
  }

  async retrieve(
    id: string,
    options?: RequestOptions,
  ): Promise<FabricResponse<EmailMessage>> {
    requireNonEmpty(id, "id");
    const response = await this.transport.request<Record<string, unknown>>({
      method: "GET",
      path: `/v1/email/messages/${encodeURIComponent(id)}`,
      ...(options ? { options } : {}),
    });
    return { ...response, data: parseEmail(record(response.data.message)) };
  }

  async list(
    options?: RequestOptions,
  ): Promise<FabricResponse<ReadonlyArray<EmailMessage>>> {
    const response = await this.transport.request<Record<string, unknown>>({
      method: "GET",
      path: "/v1/email/messages",
      ...(options ? { options } : {}),
    });
    if (!Array.isArray(response.data.messages)) {
      throw new ApiShapeError("messages");
    }
    return {
      ...response,
      data: response.data.messages.map((item) => parseEmail(record(item))),
    };
  }
}

function parseEmail(value: Record<string, unknown>): EmailMessage {
  return {
    id: stringField(value.id, "id"),
    status: enumField(value.status, STATUSES, "status"),
    to: stringField(value.to, "to"),
    from: stringField(value.from, "from"),
    subject: stringField(value.subject, "subject"),
    provider: stringField(value.provider, "provider"),
    createdAt: stringField(value.created_at, "created_at"),
    errorCode: typeof value.error_code === "string" ? value.error_code : null,
  };
}

function validateEmail(value: string, name: string): void {
  requireNonEmpty(value, name);
  if (!EMAIL.test(value)) {
    throw new TypeError(`\`${name}\` must be an email address.`);
  }
}
