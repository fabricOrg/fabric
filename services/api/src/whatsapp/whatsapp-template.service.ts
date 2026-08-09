import type { AppDb, ProvisioningDb } from "@app/db";
import type { Creds, WhatsAppTemplateRecord } from "@app/integrations";
import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { APP_DB } from "../db/db.module.js";
import { invalidRequest } from "../http/api-error.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import type { ResolvedWhatsappRuntime } from "./whatsapp-runtime.service.js";
import {
  dateFrom,
  isStale,
  optionalWabaId,
  templateStatusCode,
} from "./whatsapp-template-cache.js";

type Row = Record<string, unknown>;

@Injectable()
export class WhatsappTemplateService {
  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
  ) {}

  async syncTenant(input: {
    tenantId: string;
    runtime: ResolvedWhatsappRuntime;
  }): Promise<number> {
    const templates = await input.runtime.provider.listTemplates(
      input.runtime.creds,
    );
    const syncedAt = new Date();
    for (const template of templates) {
      await this.upsertTemplate(input.tenantId, template, syncedAt);
    }
    return templates.length;
  }

  async applyWebhookEvent(
    event: WhatsappTemplateWebhookEvent,
  ): Promise<number> {
    const tenants = await this.tenantsForWaba(event.wabaId);
    let applied = 0;
    for (const tenantId of tenants) {
      applied += await this.upsertWebhookEvent(tenantId, event);
    }
    return applied;
  }

  async assertSendable(input: {
    tenantId: string;
    creds: Creds;
    templateName: string;
    templateLanguage: string;
  }): Promise<void> {
    // A sandbox send resolves to the fake provider and carries NO credentials, so there is no WABA and
    // no Meta template cache that could apply to it. Demanding a waba_id here made every sandbox send
    // fail with `live_whatsapp_not_configured` — a template check turning into a channel outage, which
    // is exactly the failure mode the fail-open posture below exists to prevent.
    //
    // Skipping is not a hole: a LIVE send with genuinely missing credentials still fails, because the
    // adapter's own `credentialSchema` requires `waba_id` before it will call Meta.
    const wabaId = optionalWabaId(input.creds);
    if (!wabaId) return;
    const row = await this.lookupTemplate({
      tenantId: input.tenantId,
      wabaId,
      name: input.templateName,
      language: input.templateLanguage,
    });
    if (!row) {
      const latestSync = await this.latestSync(input.tenantId, wabaId);
      if (latestSync && !isStale(latestSync)) {
        throw invalidRequest(
          "whatsapp_template_not_found",
          "This WhatsApp template is not present in the latest Meta template cache.",
          "template_name",
        );
      }
      return;
    }

    const syncedAt = dateFrom(row.synced_at);
    if (!syncedAt || isStale(syncedAt)) {
      return;
    }

    const status = String(row.status).toUpperCase();
    if (status === "APPROVED") return;
    throw invalidRequest(
      templateStatusCode(status),
      `WhatsApp template '${input.templateName}' is ${status.toLowerCase()}.`,
      "template_name",
    );
  }

  private async upsertTemplate(
    tenantId: string,
    template: WhatsAppTemplateRecord,
    syncedAt: Date,
  ): Promise<void> {
    const syncedAtIso = syncedAt.toISOString();
    await this.provisioning.db.execute(sql`
      INSERT INTO whatsapp_templates (
        tenant_id, waba_id, name, language, category, status, quality_rating, components,
        synced_at, status_updated_at, quality_updated_at, category_updated_at
      ) VALUES (
        ${tenantId}, ${template.wabaId}, ${template.name}, ${template.language},
        ${template.category}, ${template.status}, ${template.qualityRating},
        ${JSON.stringify(template.components)}::jsonb, ${syncedAtIso}::timestamptz,
        ${syncedAtIso}::timestamptz, ${syncedAtIso}::timestamptz,
        ${syncedAtIso}::timestamptz
      )
      ON CONFLICT (waba_id, name, language) DO UPDATE SET
        tenant_id = EXCLUDED.tenant_id,
        category = EXCLUDED.category,
        status = EXCLUDED.status,
        quality_rating = EXCLUDED.quality_rating,
        components = EXCLUDED.components,
        synced_at = EXCLUDED.synced_at,
        status_updated_at = EXCLUDED.status_updated_at,
        quality_updated_at = EXCLUDED.quality_updated_at,
        category_updated_at = EXCLUDED.category_updated_at,
        updated_at = now()`);
  }

  private async upsertWebhookEvent(
    tenantId: string,
    event: WhatsappTemplateWebhookEvent,
  ): Promise<number> {
    const existing = await this.provisioning.db.execute(sql`
      SELECT id, status_updated_at, quality_updated_at, category_updated_at
      FROM whatsapp_templates
      WHERE tenant_id = ${tenantId}
        AND waba_id = ${event.wabaId}
        AND name = ${event.name}
        AND language = ${event.language}
      LIMIT 1`);
    const row = (existing as Row[])[0];
    if (!row) {
      await this.insertWebhookEvent(tenantId, event);
      return 1;
    }
    const gate = eventGateColumn(event.kind);
    const current = dateFrom(row[gate]);
    if (current && current > event.occurredAt) return 0;
    await this.updateWebhookEvent(tenantId, event);
    return 1;
  }

  private async insertWebhookEvent(
    tenantId: string,
    event: WhatsappTemplateWebhookEvent,
  ): Promise<void> {
    const occurredAtIso = event.occurredAt.toISOString();
    await this.provisioning.db.execute(sql`
      INSERT INTO whatsapp_templates (
        tenant_id, waba_id, name, language, category, status, quality_rating, components,
        synced_at, status_updated_at, quality_updated_at, category_updated_at
      ) VALUES (
        ${tenantId}, ${event.wabaId}, ${event.name}, ${event.language},
        ${event.kind === "category" ? event.value : null},
        ${event.kind === "status" ? event.value : "UNKNOWN"},
        ${event.kind === "quality" ? event.value : null},
        '[]'::jsonb, ${occurredAtIso}::timestamptz, ${occurredAtIso}::timestamptz,
        ${occurredAtIso}::timestamptz, ${occurredAtIso}::timestamptz
      )
      ON CONFLICT (waba_id, name, language) DO NOTHING`);
  }

  private async updateWebhookEvent(
    tenantId: string,
    event: WhatsappTemplateWebhookEvent,
  ): Promise<void> {
    const occurredAtIso = event.occurredAt.toISOString();
    if (event.kind === "status") {
      await this.provisioning.db.execute(sql`
        UPDATE whatsapp_templates
        SET status = ${event.value},
            status_updated_at = ${occurredAtIso}::timestamptz,
            updated_at = now()
        WHERE tenant_id = ${tenantId}
          AND waba_id = ${event.wabaId}
          AND name = ${event.name}
          AND language = ${event.language}`);
      return;
    }
    if (event.kind === "quality") {
      await this.provisioning.db.execute(sql`
        UPDATE whatsapp_templates
        SET quality_rating = ${event.value},
            quality_updated_at = ${occurredAtIso}::timestamptz,
            updated_at = now()
        WHERE tenant_id = ${tenantId}
          AND waba_id = ${event.wabaId}
          AND name = ${event.name}
          AND language = ${event.language}`);
      return;
    }
    await this.provisioning.db.execute(sql`
      UPDATE whatsapp_templates
      SET category = ${event.value},
          category_updated_at = ${occurredAtIso}::timestamptz,
          updated_at = now()
      WHERE tenant_id = ${tenantId}
        AND waba_id = ${event.wabaId}
        AND name = ${event.name}
        AND language = ${event.language}`);
  }

  private async lookupTemplate(input: {
    tenantId: string;
    wabaId: string;
    name: string;
    language: string;
  }): Promise<Row | null> {
    const rows = (await this.db.withTenant(
      input.tenantId,
      (tx) => tx`
        SELECT status::text, synced_at
        FROM whatsapp_templates
        WHERE waba_id = ${input.wabaId}
          AND name = ${input.name}
          AND language = ${input.language}
        LIMIT 1`,
    )) as Row[];
    return rows[0] ?? null;
  }

  private async latestSync(
    tenantId: string,
    wabaId: string,
  ): Promise<Date | null> {
    const rows = (await this.db.withTenant(
      tenantId,
      (tx) => tx`
        SELECT max(synced_at) AS synced_at
        FROM whatsapp_templates
        WHERE waba_id = ${wabaId}`,
    )) as Row[];
    return dateFrom(rows[0]?.synced_at);
  }

  private async tenantsForWaba(wabaId: string): Promise<string[]> {
    const rows = (await this.provisioning.db.execute(sql`
      SELECT DISTINCT tenant_id
      FROM whatsapp_templates
      WHERE waba_id = ${wabaId}
      UNION
      SELECT DISTINCT tenant_id
      FROM whatsapp_messages
      WHERE provider_slug <> 'sandbox-whatsapp'`)) as Row[];
    return rows.map((row) => String(row.tenant_id));
  }
}

export type WhatsappTemplateWebhookEvent = {
  readonly kind: "status" | "quality" | "category";
  readonly wabaId: string;
  readonly name: string;
  readonly language: string;
  readonly value: string;
  readonly occurredAt: Date;
};

function eventGateColumn(
  kind: WhatsappTemplateWebhookEvent["kind"],
): "status_updated_at" | "quality_updated_at" | "category_updated_at" {
  if (kind === "status") return "status_updated_at";
  if (kind === "quality") return "quality_updated_at";
  return "category_updated_at";
}
