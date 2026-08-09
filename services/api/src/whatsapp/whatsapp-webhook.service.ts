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
import {
  WhatsappTemplateService,
  type WhatsappTemplateWebhookEvent,
} from "./whatsapp-template.service.js";

type Row = Record<string, unknown>;

const metaStatusEnvelope = z.object({
  entry: z
    .array(
      z.object({
        id: z.string().trim().min(1).optional(),
        changes: z
          .array(
            z.object({
              field: z.string().trim().min(1).optional(),
              value: z.record(z.string(), z.unknown()),
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
    @Inject(WhatsappTemplateService)
    private readonly templates: WhatsappTemplateService,
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
    for (const event of metaTemplateEvents(payload)) {
      processed += await this.templates.applyWebhookEvent(event);
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
      const rawStatuses = change.value.statuses;
      if (Array.isArray(rawStatuses)) statuses.push(...rawStatuses);
    }
  }
  return statuses;
}

function metaTemplateEvents(payload: unknown): WhatsappTemplateWebhookEvent[] {
  const parsed = metaStatusEnvelope.safeParse(payload);
  if (!parsed.success) {
    throw invalidRequest(
      "invalid_whatsapp_webhook",
      "WhatsApp webhook body is not a valid Meta webhook payload.",
    );
  }
  const events: WhatsappTemplateWebhookEvent[] = [];
  for (const entry of parsed.data.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const field = change.field ?? "";
      if (!isTemplateField(field)) continue;
      const event = parseTemplateEvent(entry.id, field, change.value);
      if (event) events.push(event);
    }
  }
  return events;
}

function isTemplateField(field: string): boolean {
  return (
    field === "message_template_status_update" ||
    field === "message_template_quality_update" ||
    field === "template_category_update"
  );
}

function parseTemplateEvent(
  entryWabaId: string | undefined,
  field: string,
  value: Row,
): WhatsappTemplateWebhookEvent | null {
  const wabaId = stringValue(value, "waba_id") ?? entryWabaId;
  const name =
    stringValue(value, "message_template_name") ??
    stringValue(value, "template_name");
  const language =
    stringValue(value, "message_template_language") ??
    stringValue(value, "template_language");
  if (!wabaId || !name || !language) return null;

  const occurredAt = eventDate(value);
  if (field === "message_template_status_update") {
    const status =
      stringValue(value, "event") ??
      stringValue(value, "status") ??
      stringValue(value, "template_status");
    return status
      ? { kind: "status", wabaId, name, language, value: status, occurredAt }
      : null;
  }
  if (field === "message_template_quality_update") {
    const quality =
      stringValue(value, "new_quality_score") ??
      stringValue(value, "quality_score") ??
      stringValue(value, "quality_rating") ??
      stringValue(value, "event");
    return quality
      ? { kind: "quality", wabaId, name, language, value: quality, occurredAt }
      : null;
  }
  const category =
    stringValue(value, "new_category") ??
    stringValue(value, "correct_category") ??
    stringValue(value, "category");
  return category
    ? { kind: "category", wabaId, name, language, value: category, occurredAt }
    : null;
}

function stringValue(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function eventDate(row: Row): Date {
  const timestamp =
    numberValue(row, "timestamp") ??
    numberValue(row, "event_timestamp") ??
    numberValue(row, "webhook_trigger_timestamp") ??
    numberValue(row, "category_update_timestamp");
  return timestamp ? new Date(timestamp * 1000) : new Date();
}

function numberValue(row: Row, key: string): number | null {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function singleStatusPayload(status: unknown): unknown {
  return {
    entry: [{ changes: [{ value: { statuses: [status] } }] }],
  };
}
