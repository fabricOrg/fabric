import type {
  KillSwitchDto,
  ListKillSwitchesResponse,
  ToggleKillSwitchRequest,
} from "@app/contracts";
import { killSwitches, type NewKillSwitch, type ProvisioningDb } from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
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

@Injectable()
export class KillSwitchService {
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

  /** Runtime guard for send/charge paths: true when the capability is PAUSED (or the key is unknown
   *  we treat as operational — an unseeded switch never blocks). */
  async isPaused(key: string): Promise<boolean> {
    const [row] = await this.provisioning.db
      .select({ enabled: killSwitches.enabled })
      .from(killSwitches)
      .where(eq(killSwitches.key, key))
      .limit(1);
    return row ? !row.enabled : false;
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
