import type { WhatsappTemplateSummary } from "@app/contracts";
import type { AppDb } from "@app/db";
import {
  dateFrom,
  normalizeTemplateCategory,
} from "./whatsapp-template-cache.js";
import { templateShape } from "./whatsapp-template-shape.js";

type Row = Record<string, unknown>;

/**
 * The templates a sender may actually choose (ADR-0014 §4). Split from whatsapp-template.service.ts
 * for the file-length guard.
 *
 * APPROVED only, deliberately. The catalog also holds PENDING, REJECTED, PAUSED and DISABLED rows,
 * and every one of those fails at Meta — after the wallet reserve and after the delivery row exists.
 * Offering them would be offering a guaranteed refund cycle.
 *
 * Scoped by `tenant_id` through RLS rather than by `waba_id`: the WABA is shared across tenants in the
 * aggregator model, so a waba-scoped read would show one workspace another's templates.
 */
export async function listApprovedTemplates(
  db: AppDb,
  tenantId: string,
): Promise<{
  templates: WhatsappTemplateSummary[];
  syncedAt: Date | null;
}> {
  const rows = (await db.withTenant(
    tenantId,
    (tx) => tx`
      SELECT name, language, category, components, synced_at
      FROM whatsapp_templates
      WHERE status = 'APPROVED'
      ORDER BY name, language`,
  )) as Row[];

  let latest: Date | null = null;
  const templates = rows.map((row) => {
    const syncedAt = dateFrom(row.synced_at);
    if (syncedAt && (!latest || syncedAt > latest)) latest = syncedAt;
    const shape = templateShape(row.components);
    return {
      name: String(row.name),
      language: String(row.language),
      // Reported, never chosen. Meta owns the category, and ours drives the consent gate and the
      // pricing traffic class — so the template is the only honest source for it.
      category: normalizeTemplateCategory(row.category),
      variable_count: shape.variableCount,
      body_preview: shape.bodyPreview,
    } satisfies WhatsappTemplateSummary;
  });
  return { templates, syncedAt: latest };
}
