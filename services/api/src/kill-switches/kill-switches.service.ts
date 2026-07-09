import type {
  KillSwitchDto,
  ListKillSwitchesResponse,
  ToggleKillSwitchRequest,
} from "@app/contracts";
import { killSwitches, type NewKillSwitch, type ProvisioningDb } from "@app/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";

/** The platform circuit breakers we ship with. Seeded on read (additive). All start operational. */
const CATALOG: NewKillSwitch[] = [
  {
    key: "platform.sms_sending",
    label: "Platform SMS sending",
    description: "Master switch — pauses ALL outbound SMS across every tenant.",
    scope: "platform",
  },
  {
    key: "platform.payments",
    label: "Payments",
    description:
      "Pause wallet top-ups and charges (collections/disbursements).",
    scope: "payments",
  },
  {
    key: "provider.arkesel",
    label: "Arkesel provider",
    description: "Route sends away from Arkesel (failover / incident).",
    scope: "provider",
  },
  {
    key: "provider.africas-talking",
    label: "Africa's Talking provider",
    description:
      "Route sends away from Africa's Talking (failover / incident).",
    scope: "provider",
  },
  {
    key: "provider.hubtel",
    label: "Hubtel provider",
    description: "Route sends away from Hubtel (failover / incident).",
    scope: "provider",
  },
];

interface Actor {
  readonly email?: string | null;
  readonly staffId?: string | null;
}

/** One cached switch read: the value + when it was fetched. */
interface CachedState {
  readonly paused: boolean;
  readonly fetchedAt: number;
}

/**
 * How long a cached kill-switch state may serve reads before a fresh DB fetch. A flip lands
 * within this window on other instances (the toggling instance invalidates immediately).
 */
const CACHE_TTL_MS = 30_000;

@Injectable()
export class KillSwitchService {
  private readonly logger = new Logger(KillSwitchService.name);
  /** key → last-known-good state. Also the fallback when the control-plane DB read fails. */
  private readonly cache = new Map<string, CachedState>();

  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async ensureCatalog(): Promise<void> {
    await this.provisioning.db
      .insert(killSwitches)
      .values(CATALOG)
      .onConflictDoNothing({ target: killSwitches.key });
  }

  async list(): Promise<ListKillSwitchesResponse> {
    await this.ensureCatalog();
    const rows = await this.provisioning.db
      .select()
      .from(killSwitches)
      .orderBy(asc(killSwitches.scope), asc(killSwitches.key));
    return { switches: rows.map(toDto) };
  }

  /**
   * Runtime guard for send/charge paths: true when the capability is PAUSED (or the key is unknown
   * we treat as operational — an unseeded switch never blocks).
   *
   * Reads through a short in-memory TTL cache (ARCHITECTURE Principle #7: the control plane is
   * NEVER in the data plane's hot path). Two consequences, both deliberate:
   *   - one cheap Map hit per send instead of a control-plane DB query; a flip propagates to
   *     other instances within CACHE_TTL_MS (this instance invalidates on toggle()).
   *   - if the control-plane DB read FAILS, we serve the last-known-good value rather than
   *     failing the send — a control-plane outage must never take down the data plane. With no
   *     cached value at all we default to operational (matching the unknown-key semantics).
   */
  async isPaused(key: string): Promise<boolean> {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.paused;
    }
    try {
      const [row] = await this.provisioning.db
        .select({ enabled: killSwitches.enabled })
        .from(killSwitches)
        .where(eq(killSwitches.key, key))
        .limit(1);
      const paused = row ? !row.enabled : false;
      this.cache.set(key, { paused, fetchedAt: Date.now() });
      return paused;
    } catch (error) {
      this.logger.error(
        `kill-switch read failed for '${key}' — serving ${
          cached ? "last-known-good" : "default (operational)"
        }: ${error instanceof Error ? error.message : "unknown"}`,
      );
      // Stale beats down: last-known-good if we ever read one, else operational.
      return cached ? cached.paused : false;
    }
  }

  async toggle(
    key: string,
    request: ToggleKillSwitchRequest,
    actor: Actor,
  ): Promise<KillSwitchDto | null> {
    await this.ensureCatalog();
    const [current] = await this.provisioning.db
      .select()
      .from(killSwitches)
      .where(eq(killSwitches.key, key))
      .limit(1);
    if (!current) return null;

    const [updated] = await this.provisioning.db
      .update(killSwitches)
      .set({
        enabled: request.enabled,
        lastReason: request.reason,
        lastActorEmail: actor.email ?? null,
        updatedAt: new Date(),
      })
      .where(eq(killSwitches.key, key))
      .returning();
    if (!updated) return null;

    // This instance sees the flip immediately; peers converge within CACHE_TTL_MS.
    this.cache.set(key, { paused: !updated.enabled, fetchedAt: Date.now() });

    await this.audit.record({
      actorStaffId: actor.staffId ?? null,
      actorEmail: actor.email ?? null,
      action: "kill_switch.toggle",
      targetType: "kill_switch",
      targetId: key,
      summary: `${current.label} ${request.enabled ? "resumed" : "PAUSED"}`,
      reason: request.reason,
      metadata: { before: current.enabled, after: request.enabled },
    });

    return toDto(updated);
  }
}

function toDto(row: typeof killSwitches.$inferSelect): KillSwitchDto {
  return {
    key: row.key,
    label: row.label,
    description: row.description,
    scope: row.scope,
    enabled: row.enabled,
    last_reason: row.lastReason,
    last_actor_email: row.lastActorEmail,
    updated_at: row.updatedAt.toISOString(),
  };
}
