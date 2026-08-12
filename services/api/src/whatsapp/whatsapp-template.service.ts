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
  normalizeTemplateCategory,
  optionalWabaId,
  templateStatusCode,
} from "./whatsapp-template-cache.js";
import { tenantsForWaba } from "./whatsapp-waba-tenants.js";

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
    const tenants = await tenantsForWaba(this.provisioning, event.wabaId);
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
    /**
     * The category the CALLER claims. Checked against Meta's, because it never reaches Meta and
     * instead drives our consent gate and our pricing traffic class — so a caller claiming `utility`
     * for a marketing template would skip the promotional consent check and bill the wrong class.
     * Optional so existing callers keep compiling; when absent, nothing is claimed and nothing is
     * checked.
     */
    templateCategory?: "marketing" | "utility" | "authentication";
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
    if (status !== "APPROVED") {
      throw invalidRequest(
        templateStatusCode(status),
        `WhatsApp template '${input.templateName}' is ${status.toLowerCase()}.`,
        "template_name",
      );
    }

    // Meta owns the category. Rejecting a mismatch rather than silently overriding it: overriding
    // would change what the caller is BILLED and which consent rules apply without telling them,
    // and the correct value is knowable, so the error can name it. An unmapped category (null) is
    // not treated as a mismatch — we cannot claim to know better than the caller about a value we
    // failed to recognise.
    const actual = normalizeTemplateCategory(row.category);
    if (input.templateCategory && actual && actual !== input.templateCategory) {
      throw invalidRequest(
        "whatsapp_template_category_mismatch",
        `Meta classifies '${input.templateName}' as ${actual}, not ${input.templateCategory}. The category decides consent rules and pricing, so it must match.`,
        "template_category",
      );
    }
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
      -- Tenant-scoped key (0150): on waba_id alone this DO UPDATE reassigned the row to the syncing
      -- tenant, so a shared WABA handed every template to whichever tenant synced last.
      ON CONFLICT (tenant_id, waba_id, name, language) DO UPDATE SET
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
    // A webhook is authoritative about a template's STATUS, never about its CONTENT — the payload
    // carries no components. So an event for a template this tenant has never synced cannot be turned
    // into a cache row without inventing one, and this used to do exactly that: status "UNKNOWN",
    // components '[]', and synced_at stamped from the event as though a catalog read had happened.
    //
    // It was masked until 0150, because the old WABA-global unique key meant one tenant already owned
    // the row and every other tenant's insert hit ON CONFLICT DO NOTHING. Tenant-scoping the key made
    // those inserts land, which would have been actively harmful in two ways: a fabricated synced_at
    // makes latestSync() look fresh, flipping assertSendable from fail-open to a hard 400 for every
    // OTHER template that tenant sends; and a status=APPROVED event would publish a component-less
    // row straight into the compose picker, where choosing it reserves money for a send Meta then
    // rejects.
    //
    // Skipping loses nothing real. A tenant with no cached template already fails OPEN at
    // assertSendable, so there was no protection to preserve, and the next sync fetches the true
    // record from Meta. Returning 0 is also the honest answer for the caller's `processed` count.
    if (!row) return 0;
    const gate = eventGateColumn(event.kind);
    const current = dateFrom(row[gate]);
    if (current && current > event.occurredAt) return 0;
    await this.updateWebhookEvent(tenantId, event);
    return 1;
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
        SELECT status::text, category, synced_at
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
