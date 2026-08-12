import type { ProvisioningDb } from "@app/db";
import { sql } from "drizzle-orm";

type Row = Record<string, unknown>;

/**
 * Which tenants the platform WABA's template catalog applies to.
 *
 * Two arms, and the second one is the point. The first covers tenants that already hold rows for this
 * WABA. The second is what lets a workspace BOOTSTRAP: previously the only other arm was "has already
 * sent a non-sandbox WhatsApp message", so a workspace that had never sent could never receive a
 * first sync, and its compose picker stayed empty forever — the state testing is in right now, with
 * zero templates and zero messages. Chicken-and-egg by construction.
 *
 * An active LIVE environment is the honest predicate for "may send on this WABA": sandbox routes to
 * the fake provider and never reaches Meta, and the live environment is unlocked by go-live. It also
 * subsumes the old messages arm, since a live send requires a live environment.
 *
 * DELIBERATELY UNSCOPED, and correct only while ONE shared WABA exists. `environments` carries no
 * `waba_id` — no more than `whatsapp_messages` did — so this arm returns every live tenant regardless
 * of which WABA they belong to. ADR-0016 decides per-tenant WABAs, and on the day a second one exists
 * this hands WABA-B's template events to WABA-A's tenants and writes the wrong catalog. Whatever
 * carries the tenant→WABA binding then must be joined here; this cannot ship past that point unchanged.
 *
 * Shared because the scheduler and the webhook fan-out need exactly this set and had a copy each.
 *
 * Widening it also flips a posture: every live tenant now gets a populated cache within the hour, so
 * their first WhatsApp send moves from fail-open to fail-closed on an unknown template. That is the
 * intent — an empty cache was never a safety property — but it is a behaviour change for tenants who
 * have never used the channel.
 */
export async function tenantsForWaba(
  provisioning: ProvisioningDb,
  wabaId: string,
): Promise<string[]> {
  const rows = (await provisioning.db.execute(sql`
    SELECT DISTINCT tenant_id
    FROM whatsapp_templates
    WHERE waba_id = ${wabaId}
    UNION
    SELECT DISTINCT tenant_id
    FROM environments
    WHERE type = 'live' AND status = 'active'`)) as Row[];
  return rows.map((row) => String(row.tenant_id));
}
