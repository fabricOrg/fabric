import type { AppDb } from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { APP_DB } from "../db/db.module.js";
import {
  forbidden,
  invalidRequest,
  notFound,
  unauthorized,
} from "../http/api-error.js";
import { resolveWhatsappStatus } from "./whatsapp-resolve.js";
import { WhatsappRuntimeService } from "./whatsapp-runtime.service.js";

type Row = Record<string, unknown>;

const metaStatusEnvelope = z.object({
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              value: z.object({
                statuses: z.array(z.unknown()).optional(),
              }),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

@Injectable()
export class WhatsappWebhookService {
  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(WhatsappRuntimeService)
    private readonly runtime: WhatsappRuntimeService,
  ) {}

  async verifyChallenge(input: {
    providerSlug: string;
    mode?: unknown;
    verifyToken?: unknown;
    challenge?: unknown;
  }): Promise<string> {
    if (
      input.mode !== "subscribe" ||
      typeof input.verifyToken !== "string" ||
      typeof input.challenge !== "string"
    ) {
      throw forbidden(
        "invalid_whatsapp_webhook_challenge",
        "WhatsApp webhook verification failed.",
      );
    }
    const resolved = await this.resolveProvider(input.providerSlug);
    if (resolved.creds.webhook_verify_token !== input.verifyToken) {
      throw forbidden(
        "invalid_whatsapp_webhook_challenge",
        "WhatsApp webhook verification failed.",
      );
    }
    return input.challenge;
  }

  async ingest(
    providerSlug: string,
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ processed: number }> {
    const resolved = await this.resolveProvider(providerSlug);
    if (
      !resolved.provider.verifyWebhook(
        { headers: normalizeHeaders(headers), rawBody },
        resolved.creds,
      )
    ) {
      throw unauthorized(
        "invalid_whatsapp_signature",
        "WhatsApp webhook signature invalid.",
      );
    }

    const payload = parseWebhookJson(rawBody);
    let processed = 0;
    for (const status of metaStatuses(payload)) {
      const dlr = resolved.provider.parseDlr(singleStatusPayload(status));
      const tenantId = await this.lookupTenant(providerSlug, dlr.providerRef);
      await resolveWhatsappStatus(this.db, this.runtime, {
        tenantId,
        messageRef: dlr.providerRef,
        status: dlr.status,
        lookupBy: "providerRef",
        ...(dlr.errorCode ? { errorCode: dlr.errorCode } : {}),
      });
      processed += 1;
    }
    return { processed };
  }

  private async resolveProvider(providerSlug: string) {
    const resolved = await this.runtime.resolve("live");
    if (resolved.provider.slug !== providerSlug) {
      throw notFound(
        "unknown_provider",
        `No WhatsApp provider '${providerSlug}'.`,
      );
    }
    return resolved;
  }

  private async lookupTenant(
    providerSlug: string,
    providerRef: string,
  ): Promise<string> {
    const tenantId = await this.db.withProviderRefLookup(
      providerRef,
      async (tx) => {
        const rows = (await tx`
          SELECT tenant_id FROM whatsapp_messages
          WHERE provider_slug = ${providerSlug}
            AND provider_ref = ${providerRef}`) as Row[];
        return rows[0]?.tenant_id ? String(rows[0].tenant_id) : null;
      },
    );
    if (!tenantId) {
      throw notFound(
        "whatsapp_message_not_found",
        `No WhatsApp message exists for provider_ref ${providerRef}.`,
      );
    }
    return tenantId;
  }
}

function normalizeHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key] = Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
  }
  return normalized;
}

function parseWebhookJson(rawBody: Buffer): unknown {
  try {
    return JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw invalidRequest(
      "invalid_whatsapp_webhook",
      "WhatsApp webhook body must be valid JSON.",
    );
  }
}

function metaStatuses(payload: unknown): unknown[] {
  const parsed = metaStatusEnvelope.safeParse(payload);
  if (!parsed.success) {
    throw invalidRequest(
      "invalid_whatsapp_webhook",
      "WhatsApp webhook body is not a valid Meta status payload.",
    );
  }
  const statuses: unknown[] = [];
  for (const entry of parsed.data.entry ?? []) {
    for (const change of entry.changes ?? []) {
      statuses.push(...(change.value.statuses ?? []));
    }
  }
  return statuses;
}

function singleStatusPayload(status: unknown): unknown {
  return {
    entry: [{ changes: [{ value: { statuses: [status] } }] }],
  };
}
