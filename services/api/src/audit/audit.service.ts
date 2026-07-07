import type { ListAuditResponse } from "@app/contracts";
import { auditEvents, type ProvisioningDb } from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { desc } from "drizzle-orm";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";

export interface AuditRecordInput {
  readonly actorStaffId?: string | null;
  readonly actorEmail?: string | null;
  readonly action: string;
  readonly targetType?: string | null;
  readonly targetId?: string | null;
  readonly summary: string;
  readonly reason?: string | null;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Append-only audit log. Other services inject this and call `record()` after a consequential action
 * (kill-switch toggle, staff change, impersonation, maker-checker decision). Never updates/deletes.
 */
@Injectable()
export class AuditService {
  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
  ) {}

  async record(input: AuditRecordInput): Promise<void> {
    await this.provisioning.db.insert(auditEvents).values({
      actorStaffId: input.actorStaffId ?? null,
      actorEmail: input.actorEmail ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      summary: input.summary,
      reason: input.reason ?? null,
      metadata: input.metadata ?? {},
    });
  }

  async list(limit = 100): Promise<ListAuditResponse> {
    const rows = await this.provisioning.db
      .select({
        id: auditEvents.id,
        actor_email: auditEvents.actorEmail,
        action: auditEvents.action,
        target_type: auditEvents.targetType,
        target_id: auditEvents.targetId,
        summary: auditEvents.summary,
        reason: auditEvents.reason,
        metadata: auditEvents.metadata,
        created_at: auditEvents.createdAt,
      })
      .from(auditEvents)
      .orderBy(desc(auditEvents.createdAt))
      .limit(Math.min(Math.max(limit, 1), 500));
    return {
      events: rows.map((r) => ({
        ...r,
        metadata: (r.metadata ?? {}) as Record<string, unknown>,
        created_at: r.created_at.toISOString(),
      })),
    };
  }
}
