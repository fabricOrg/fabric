import type { ProvisioningDb } from "@app/db";
import { sql } from "drizzle-orm";
import type { PiiVaultService } from "../privacy/pii-vault.service.js";

type Row = Record<string, unknown>;

/**
 * WHOSE MESSAGE IS THIS? (ADR-0015 §1)
 *
 * Meta delivers an inbound message to the shared WABA and tells us the consumer's number and our own
 * — never which tenant it is for. The rule: the tenant of the most recent OUTBOUND to that consumer
 * inside the service window. Not a heuristic reached for convenience — it is the same 24 hours Meta
 * uses to decide whether a business may reply at all, so outside it there is no conversation for the
 * message to belong to.
 *
 * The known failure: two tenants messaging the same consumer inside one window cross-attribute, and
 * the second one wins. Both are legitimate senders to that number, so nothing available to us
 * separates them. The fix is per-tenant numbers, not a cleverer rule.
 */

/** Meta's customer service window. Also the attribution lookback — see above, it is the same clock. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface InboundAttribution {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly applicationId: string;
  readonly environmentId: string;
}

/**
 * Resolve the owning tenant, or null when nobody messaged this consumer inside the window.
 *
 * The probe is READ-ONLY by construction: `findSubjectForPhone` looks up, where `subjectForPhone`
 * would CREATE. Probing must not leave a data-subject row in every tenant on the WABA — that would
 * manufacture the appearance of a relationship that does not exist, and widen the blast radius of any
 * later leak.
 */
export async function attributeInbound(
  deps: { provisioning: ProvisioningDb; vault: PiiVaultService },
  input: { e164: string; providerSlug: string; receivedAt: Date },
): Promise<InboundAttribution | null> {
  const since = new Date(input.receivedAt.getTime() - SERVICE_WINDOW_MS);
  const candidates = await candidateTenants(deps.provisioning, {
    providerSlug: input.providerSlug,
    since,
  });
  let best: (InboundAttribution & { sentAt: Date }) | null = null;
  for (const tenantId of candidates) {
    // One lookup per candidate. The candidate set is bounded by "tenants that sent live WhatsApp in
    // the last 24 hours", which is small; if that stops being true, the blind index is deterministic
    // per (tenant, number) and this becomes one query with a VALUES list.
    const subjectId = await deps.vault.findSubjectForPhone(
      tenantId,
      input.e164,
    );
    if (!subjectId) continue;
    const latest = await latestOutbound(deps.provisioning, {
      tenantId,
      subjectId,
      providerSlug: input.providerSlug,
      since,
    });
    if (!latest) continue;
    if (!best || latest.sentAt > best.sentAt) {
      best = { ...latest, tenantId, subjectId };
    }
  }
  if (!best) return null;
  const { sentAt: _sentAt, ...attribution } = best;
  return attribution;
}

/**
 * Tenants that could plausibly own an inbound right now: those with live outbound WhatsApp inside the
 * window. Read through the PROVISIONING connection because the question spans tenants by nature — no
 * single tenant's RLS scope can answer "who was talking to this number".
 */
async function candidateTenants(
  provisioning: ProvisioningDb,
  input: { providerSlug: string; since: Date },
): Promise<string[]> {
  const rows = (await provisioning.db.execute(sql`
    SELECT DISTINCT tenant_id
    FROM whatsapp_messages
    WHERE provider_slug = ${input.providerSlug}
      AND created_at >= ${input.since.toISOString()}::text::timestamptz`)) as Row[];
  return rows.map((row) => String(row.tenant_id));
}

/** The most recent outbound from this tenant to this consumer inside the window. */
async function latestOutbound(
  provisioning: ProvisioningDb,
  input: {
    tenantId: string;
    subjectId: string;
    providerSlug: string;
    since: Date;
  },
): Promise<{
  applicationId: string;
  environmentId: string;
  sentAt: Date;
} | null> {
  const rows = (await provisioning.db.execute(sql`
    SELECT application_id, environment_id, created_at
    FROM whatsapp_messages
    WHERE tenant_id = ${input.tenantId}
      AND subject_id = ${input.subjectId}
      AND provider_slug = ${input.providerSlug}
      AND created_at >= ${input.since.toISOString()}::text::timestamptz
    ORDER BY created_at DESC
    LIMIT 1`)) as Row[];
  const row = rows[0];
  if (!row) return null;
  return {
    applicationId: String(row.application_id),
    environmentId: String(row.environment_id),
    // `execute()` returns timestamptz as a STRING (a repo-wide trap), so parse rather than cast.
    sentAt: new Date(String(row.created_at)),
  };
}
