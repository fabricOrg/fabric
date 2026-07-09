import type { ListAuditResponse } from "@app/contracts";
import {
  auditEvents,
  clampLimit,
  decodeCursor,
  encodeCursor,
  keysetWhere,
  type ProvisioningDb,
  takePage,
} from "@app/db";
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

  /**
   * Keyset-paginated newest-first. `cursor` (from a prior page's next_cursor) resumes strictly
   * older than that (created_at, id) pair — keyset, not offset, so entries landing at the head
   * while an operator pages can't shift the window and cause a skip/duplicate. Fetches one extra
   * row to decide whether an older page exists.
   */
  async list(
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<ListAuditResponse> {
    const pageSize = clampLimit(opts.limit);
    const decoded = opts.cursor ? decodeCursor(opts.cursor) : null;
    // Standard keyset on (created_at DESC, id DESC) — id breaks created_at ties for a stable order.
    const keyset = keysetWhere(
      auditEvents.createdAt,
      auditEvents.id,
      "desc",
      decoded
        ? { primaryValue: new Date(decoded.primary), id: decoded.id }
        : null,
    );

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
      .where(keyset)
      .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
      .limit(pageSize + 1);

    const { page, nextCursor } = takePage(rows, pageSize, (r) =>
      encodeCursor(r.created_at.toISOString(), r.id),
    );
    return {
      events: page.map((r) => ({
        ...r,
        metadata: (r.metadata ?? {}) as Record<string, unknown>,
        created_at: r.created_at.toISOString(),
      })),
      next_cursor: nextCursor,
    };
  }
}
