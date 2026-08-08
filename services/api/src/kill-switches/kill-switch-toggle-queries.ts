import type { ToggleKillSwitchRequest } from "@app/contracts";
import {
  accounts,
  killSwitches,
  type ProvisioningDb,
  type TenantId,
} from "@app/db";
import { and, eq, isNull } from "drizzle-orm";
import { notFound } from "../http/api-error.js";
import type { KillSwitchRow } from "./kill-switches.catalog.js";

/**
 * The row reads and writes behind `KillSwitchService.toggle`, split out for the file-length guard.
 * They stay dumb on purpose: precedence and cache invalidation are the service's job, and a helper
 * that decided either would be a second place for the platform/tenant rule to disagree with itself.
 */

/** The workspace's display name — and the structured 404 for an id that names no workspace. */
export async function requireTenantName(
  provisioning: ProvisioningDb,
  tenantId: string,
): Promise<string> {
  const [account] = await provisioning.db
    .select({ name: accounts.name })
    .from(accounts)
    .where(eq(accounts.id, tenantId as TenantId))
    .limit(1);
  if (!account) {
    throw notFound("tenant_not_found", "Unknown workspace.");
  }
  return account.name;
}

export async function readPlatformRow(
  provisioning: ProvisioningDb,
  key: string,
): Promise<KillSwitchRow | undefined> {
  const [row] = await provisioning.db
    .select()
    .from(killSwitches)
    .where(and(eq(killSwitches.key, key), isNull(killSwitches.tenantId)))
    .limit(1);
  return row;
}

export async function readTenantRow(
  provisioning: ProvisioningDb,
  key: string,
  tenantId: string,
): Promise<KillSwitchRow | undefined> {
  const [row] = await provisioning.db
    .select()
    .from(killSwitches)
    .where(and(eq(killSwitches.key, key), eq(killSwitches.tenantId, tenantId)))
    .limit(1);
  return row;
}

export async function writePlatformSwitch(
  provisioning: ProvisioningDb,
  key: string,
  request: ToggleKillSwitchRequest,
  actorEmail: string | null,
): Promise<KillSwitchRow | undefined> {
  const [updated] = await provisioning.db
    .update(killSwitches)
    .set({
      enabled: request.enabled,
      lastReason: request.reason,
      lastActorEmail: actorEmail,
      updatedAt: new Date(),
    })
    .where(and(eq(killSwitches.key, key), isNull(killSwitches.tenantId)))
    .returning();
  return updated;
}

/**
 * Upsert: the first flip for a workspace creates its row, later ones amend it. The override copies
 * the platform row's label/description/scope so a key means the same thing at both scopes — the
 * admin console renders them together and two descriptions for one capability would read as two
 * capabilities.
 */
export async function writeTenantOverride(
  provisioning: ProvisioningDb,
  tenantId: string,
  platform: KillSwitchRow,
  request: ToggleKillSwitchRequest,
  actorEmail: string | null,
): Promise<KillSwitchRow | undefined> {
  const [updated] = await provisioning.db
    .insert(killSwitches)
    .values({
      key: platform.key,
      tenantId,
      label: platform.label,
      description: platform.description,
      scope: platform.scope,
      enabled: request.enabled,
      lastReason: request.reason,
      lastActorEmail: actorEmail,
    })
    .onConflictDoUpdate({
      target: [killSwitches.key, killSwitches.tenantId],
      set: {
        enabled: request.enabled,
        lastReason: request.reason,
        lastActorEmail: actorEmail,
        updatedAt: new Date(),
      },
    })
    .returning();
  return updated;
}
