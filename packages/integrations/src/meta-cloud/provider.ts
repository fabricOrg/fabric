import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type {
  CanonicalDlr,
  Creds,
  HealthState,
  IncomingRequest,
  JsonSchema,
  NormalizedWhatsAppTemplateMessage,
  ProviderResult,
  RequestContext,
  WhatsAppSenderPlugin,
} from "../plugin.js";
import { updateWithRawBody } from "../plugin.js";
import { parseMetaDlr } from "./dlr.js";
import { MetaCloudError } from "./errors.js";

export { MetaCloudError } from "./errors.js";

const GRAPH_API_VERSION = "v20.0";
const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const SUPPORTED_COUNTRIES = new Set(["GH", "NG"]);

const credentialSchema = z.object({
  phone_number_id: z.string().trim().min(1),
  waba_id: z.string().trim().min(1),
  access_token: z.string().trim().min(1),
  app_secret: z.string().trim().min(1),
  webhook_verify_token: z.string().trim().min(1),
});

type MetaCloudCredentials = z.infer<typeof credentialSchema>;

const metaSendResponseSchema = z.object({
  messages: z.array(z.object({ id: z.string().trim().min(1) })).optional(),
});

const metaErrorResponseSchema = z.object({
  error: z.object({ message: z.string().trim().min(1).optional() }).optional(),
});

type MetaFetch = (
  input: string,
  init: {
    readonly method: "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
  },
) => Promise<Response>;

export class MetaCloudProvider implements WhatsAppSenderPlugin {
  readonly slug = "meta-cloud";
  readonly capability = "whatsapp" as const;
  readonly version = "1.0.0";
  readonly billableStatuses = ["accepted"] as const;
  readonly configSchema: JsonSchema = {
    type: "object",
    required: [
      "phone_number_id",
      "waba_id",
      "access_token",
      "app_secret",
      "webhook_verify_token",
    ],
    properties: {
      phone_number_id: { type: "string" },
      waba_id: { type: "string" },
      access_token: { type: "string" },
      app_secret: { type: "string" },
      webhook_verify_token: { type: "string" },
    },
  };

  constructor(private readonly transport: MetaFetch = fetch) {}

  supports(ctx: RequestContext): boolean {
    return (
      !ctx.destinationCountry ||
      SUPPORTED_COUNTRIES.has(ctx.destinationCountry.toUpperCase())
    );
  }

  healthCheck(): Promise<HealthState> {
    return Promise.resolve({ status: "up" });
  }

  async send(
    message: NormalizedWhatsAppTemplateMessage,
    creds: Creds,
  ): Promise<ProviderResult> {
    const credential = parseCredentials(creds);
    const response = await this.transport(
      `${BASE_URL}/${encodeURIComponent(credential.phone_number_id)}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(toMetaMessage(message)),
      },
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 || response.status >= 500) {
        throw new MetaCloudError(
          "whatsapp_provider_unavailable",
          metaErrorMessage(payload, response.status),
        );
      }
      return {
        status: "failed",
        raw: payload,
      };
    }

    const providerRef = extractProviderRef(payload);
    if (!providerRef) {
      throw new MetaCloudError(
        "whatsapp_provider_anomaly",
        "Meta Cloud accepted the request without returning a message id.",
      );
    }
    return { status: "accepted", providerRef, raw: payload };
  }

  verifyWebhook(req: IncomingRequest, creds: Creds): boolean {
    const appSecret = creds.app_secret?.trim();
    if (!appSecret) return false;

    const provided = header(req.headers, "x-hub-signature-256");
    if (!provided) return false;

    const actual = provided.startsWith("sha256=")
      ? provided.slice("sha256=".length)
      : provided;
    if (!isHex(actual)) return false;

    const expected = updateWithRawBody(
      createHmac("sha256", appSecret),
      req.rawBody,
    ).digest("hex");
    const a = Buffer.from(actual, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseDlr(payload: unknown): CanonicalDlr {
    return parseMetaDlr(payload);
  }
}

function parseCredentials(creds: Creds): MetaCloudCredentials {
  const parsed = credentialSchema.safeParse(creds);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const param = issue?.path[0];
  const field = typeof param === "string" ? param : undefined;
  throw new MetaCloudError(
    "whatsapp_invalid_credentials",
    field
      ? `Meta Cloud credential '${field}' is required.`
      : "Meta Cloud credentials are invalid.",
    field,
  );
}

function toMetaMessage(message: NormalizedWhatsAppTemplateMessage): unknown {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: message.to,
    type: "template",
    template: {
      name: message.templateName,
      language: { code: message.templateLanguage },
      ...(message.variables.length > 0
        ? {
            components: [
              {
                type: "body",
                parameters: message.variables.map((text) => ({
                  type: "text",
                  text,
                })),
              },
            ],
          }
        : {}),
    },
  };
}

function metaErrorMessage(payload: unknown, status: number): string {
  const parsed = metaErrorResponseSchema.safeParse(payload);
  const message = parsed.success ? parsed.data.error?.message : undefined;
  if (message) return message;
  return `Meta Cloud send failed (${status}).`;
}

function extractProviderRef(payload: unknown): string | undefined {
  const parsed = metaSendResponseSchema.safeParse(payload);
  return parsed.success ? parsed.data.messages?.[0]?.id : undefined;
}

function header(
  headers: Readonly<Record<string, string>>,
  name: string,
): string | undefined {
  const exact = headers[name];
  if (exact) return exact;
  const found = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name,
  );
  return found?.[1];
}

function isHex(value: string): boolean {
  return (
    value.length > 0 && value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value)
  );
}
