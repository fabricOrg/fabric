import type {
  KillSwitchDto,
  ListKillSwitchesResponse,
  ToggleKillSwitchRequest,
} from "@app/contracts";
import { accounts, killSwitches, type ProvisioningDb } from "@app/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  and,
  asc,
  eq,
  isNull,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { invalidRequest } from "../http/api-error.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import { KillSwitchCache } from "./kill-switch-cache.js";
import {
  readPlatformRow,
  readTenantRow,
  requireTenantName,
  writePlatformSwitch,
  writeTenantOverride,
} from "./kill-switch-toggle-queries.js";
import {
  CATALOG,
  LIVE_PROVIDER_KEYS,
  PLATFORM_ONLY_KEYS,
  toDto,
} from "./kill-switches.catalog.js";

interface Actor {
  readonly email?: string | null;
  readonly staffId?: string | null;
}

/** The rows that decide one capability for one caller: the platform breaker, plus this tenant's. */
function scopedToTenant(tenantId: string | null): SQL | undefined {
  if (!tenantId) return isNull(killSwitches.tenantId);
  return or(isNull(killSwitches.tenantId), eq(killSwitches.tenantId, tenantId));
}

@Injectable()
export class KillSwitchService {
  private readonly logger = new Logger(KillSwitchService.name);
  private readonly cache = new KillSwitchCache();

  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async ensureCatalog(): Promise<void> {
    // The unique key is (key, tenant_id) since 0133, so the conflict target names both columns —
    // a bare `key` target no longer matches a constraint and Postgres rejects the statement.
    await this.provisioning.db
      .insert(killSwitches)
      .values(CATALOG)
      .onConflictDoNothing({
        target: [killSwitches.key, killSwitches.tenantId],
      });
    // Prune dead PROVIDER switches — a `provider.*` row with no matching adapter in the current
    // catalog (e.g. the retired africas-talking / hubtel / old arkesel keys, finding 9). Runs on
    // the provisioner connection (kill_switches DML is provisioner-only — a migration can't do
    // this, it runs as app_migrator which lacks the grant). Scoped to `provider.*` so a platform
    // switch is never touched, and unscoped by tenant so a retired provider's overrides go too;
    // self-healing on every read.
    await this.provisioning.db
      .delete(killSwitches)
      .where(
        and(
          eq(killSwitches.scope, "provider"),
          notInArray(killSwitches.key, LIVE_PROVIDER_KEYS),
        ),
      );
  }

  async list(): Promise<ListKillSwitchesResponse> {
    await this.ensureCatalog();
    const rows = await this.provisioning.db
      .select({ row: killSwitches, tenantName: accounts.name })
      .from(killSwitches)
      .leftJoin(accounts, eq(accounts.id, killSwitches.tenantId))
      .orderBy(
        asc(killSwitches.scope),
        asc(killSwitches.key),
        // Platform breaker first, then its overrides — Postgres sorts NULLs last by default.
        sql`${killSwitches.tenantId} asc nulls first`,
      );
    const platformPaused = new Set(
      rows
        .filter(({ row }) => row.tenantId === null && !row.enabled)
        .map(({ row }) => row.key),
    );
    return {
      switches: rows.map(({ row, tenantName }) =>
        toDto(row, tenantName, platformPaused.has(row.key)),
      ),
    };
  }

  /**
   * Runtime guard for send/charge paths: true when the capability is PAUSED for this caller.
   *
   * PRECEDENCE is platform OR tenant. Both rows are read in ONE query and the answer is whether
   * EITHER pauses, so an override can halt one workspace but never resume it past a platform halt.
   * Passing no tenant asks the platform question alone.
   *
   * Reads through a short TTL cache (ARCHITECTURE Principle #7: the control plane is NEVER in the
   * data plane's hot path). Two consequences, both deliberate:
   *   - one cheap Map hit per send instead of a control-plane DB query; a flip propagates to other
   *     instances within CACHE_TTL_MS (the toggling instance invalidates its own entries).
   *   - if the control-plane DB read FAILS, we serve the last-known-good value rather than failing
   *     the send — a control-plane outage must never take down the data plane. With no cached value
   *     at all we default to operational (an unseeded switch never blocks).
   */
  async isPaused(key: string, tenantId?: string | null): Promise<boolean> {
    const tenant = tenantId ?? null;
    const now = Date.now();
    const cached = this.cache.fresh(key, tenant, now);
    if (cached !== undefined) return cached;
    // Sampled BEFORE the read: a toggle landing while this query is in flight must discard the
    // answer rather than let it be written back over the invalidation.
    const generation = this.cache.generation(key);
    try {
      const rows = await this.provisioning.db
        .select({ enabled: killSwitches.enabled })
        .from(killSwitches)
        .where(and(eq(killSwitches.key, key), scopedToTenant(tenant)));
      const paused = rows.some((r) => !r.enabled);
      this.cache.set(key, tenant, paused, now, generation);
      return paused;
    } catch (error) {
      const lastKnownGood = this.cache.lastKnownGood(key, tenant);
      this.logger.error(
        `kill-switch read failed for '${key}'${tenant ? ` (tenant ${tenant})` : ""} — serving ${
          lastKnownGood === undefined
            ? "default (operational)"
            : "last-known-good"
        }: ${error instanceof Error ? error.message : "unknown"}`,
      );
      // Stale beats down: last-known-good if we ever read one, else operational.
      return lastKnownGood ?? false;
    }
  }

  /**
   * Self-serve signup gate (PI-6 / ADR-0004). The ONE switch that FAILS CLOSED, unlike the
   * send/charge breakers above: opening a workspace to a stranger is an abuse/fraud/cost action, not
   * an availability-critical one — so an unknown/unseeded/unreadable switch means signup is DISABLED
   * (a control-plane blip must never open the front door). Seeded OFF (`platform.signup`); an
   * operator flips it on from the admin console once abuse controls land. Platform-scoped only:
   * there is no tenant yet to scope it to. Shares isPaused's TTL cache so it's a Map hit per signup.
   */
  async signupEnabled(): Promise<boolean> {
    const key = "platform.signup";
    const now = Date.now();
    const cached = this.cache.fresh(key, null, now);
    if (cached !== undefined) return !cached;
    const generation = this.cache.generation(key);
    try {
      const [row] = await this.provisioning.db
        .select({ enabled: killSwitches.enabled })
        .from(killSwitches)
        .where(and(eq(killSwitches.key, key), isNull(killSwitches.tenantId)))
        .limit(1);
      // Unseeded/unknown → DISABLED (fail closed). ensureCatalog (list/toggle) seeds it enabled:false.
      const enabled = row?.enabled ?? false;
      this.cache.set(key, null, !enabled, now, generation);
      return enabled;
    } catch (error) {
      this.logger.error(
        `signup kill-switch read failed — failing CLOSED (signup disabled): ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
      const lastKnownGood = this.cache.lastKnownGood(key, null);
      return lastKnownGood === undefined ? false : !lastKnownGood;
    }
  }

  /**
   * Flip one switch. `tenant_id` picks WHICH: absent = the platform breaker (must already exist in
   * the catalog), present = that workspace's override, INSERTed on first flip and carrying the
   * platform row's label/description/scope so a key means the same thing at both scopes.
   *
   * Returns null for an unknown key so the controller can 404; an unknown tenant throws, because a
   * caller naming a workspace that does not exist has made a different mistake.
   */
  async toggle(
    key: string,
    request: ToggleKillSwitchRequest,
    actor: Actor,
  ): Promise<KillSwitchDto | null> {
    await this.ensureCatalog();
    const platform = await readPlatformRow(this.provisioning, key);
    if (!platform) return null;

    const tenantId = request.tenant_id ?? null;
    if (tenantId && PLATFORM_ONLY_KEYS.has(key)) {
      throw invalidRequest(
        "switch_not_tenant_scopable",
        `${platform.label} is a platform-wide switch and cannot be scoped to one workspace.`,
        "tenant_id",
      );
    }
    const actorEmail = actor.email ?? null;
    const tenantName = tenantId
      ? await requireTenantName(this.provisioning, tenantId)
      : null;
    const current = tenantId
      ? await readTenantRow(this.provisioning, key, tenantId)
      : platform;
    const updated = tenantId
      ? await writeTenantOverride(
          this.provisioning,
          tenantId,
          platform,
          request,
          actorEmail,
        )
      : await writePlatformSwitch(this.provisioning, key, request, actorEmail);
    if (!updated) return null;

    // Both rows decide the answer, so a write to either invalidates every cached entry for the key
    // rather than caching what was just written — the writer cannot see the other row's state.
    this.cache.invalidateKey(key);

    await this.audit.record({
      actorStaffId: actor.staffId ?? null,
      actorEmail: actor.email ?? null,
      action: "kill_switch.toggle",
      targetType: "kill_switch",
      targetId: key,
      summary: `${platform.label} ${request.enabled ? "resumed" : "PAUSED"}${
        tenantName ? ` for ${tenantName}` : ""
      }`,
      reason: request.reason,
      metadata: {
        before: current?.enabled ?? true,
        after: request.enabled,
        tenantId,
      },
    });

    return toDto(updated, tenantName, !platform.enabled && tenantId !== null);
  }
}
