import type { Transport } from "./transport.js";
import type {
  FabricResponse,
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
}

/**
 * Managed messages. `preview` renders a released definition by stable key through the same engine a
 * send uses — no send, charge, or persistence. Blockers (validation/render errors) carry a field path
 * and code, never a value.
 */
export class MessagesResource {
  constructor(private readonly transport: Transport) {}

  async preview(
    key: string,
    options?: PreviewMessageOptions,
  ): Promise<FabricResponse<MessagePreview>> {
    requireNonEmpty(key, "key");
    const { data, currency, to, locale, ...requestOptions } = options ?? {};
    const response = await this.transport.request<Record<string, unknown>>({
      method: "POST",
      path: "/v1/messages/preview",
      body: {
        key,
        ...(data ? { data } : {}),
        ...(currency ? { currency } : {}),
        ...(to ? { to } : {}),
        ...(locale ? { locale } : {}),
      },
      ...(Object.keys(requestOptions).length > 0
        ? { options: requestOptions }
        : {}),
    });
    return { ...response, data: parsePreview(response.data) };
  }
}

function parsePreview(data: Record<string, unknown>): MessagePreview {
  const rawBlockers = Array.isArray(data.blockers) ? data.blockers : [];
  const rawWarnings = Array.isArray(data.warnings) ? data.warnings : [];
  const sender = record(data.sender);
  const previewValue = data.preview;
  return {
    versionId: stringField(data.version_id, "version_id"),
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
