import type { Transport } from "./transport.js";
import type {
  FabricResponse,
  MessagePreview,
  RequestOptions,
  SmsPreview,
} from "./types.js";
import {
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
    const { data, currency, ...requestOptions } = options ?? {};
    const response = await this.transport.request<Record<string, unknown>>({
      method: "POST",
      path: "/v1/messages/preview",
      body: {
        key,
        ...(data ? { data } : {}),
        ...(currency ? { currency } : {}),
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
