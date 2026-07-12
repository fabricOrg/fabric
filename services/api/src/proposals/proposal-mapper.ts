import type { ProposalDto } from "@app/contracts";
import type { proposals } from "@app/db";

/** Row → API DTO. Kept out of the service file so it stays under the length guard (one concern each). */
export function toProposalDto(row: typeof proposals.$inferSelect): ProposalDto {
  return {
    id: row.id,
    kind: row.kind as ProposalDto["kind"],
    tenant_id: row.tenantId,
    tenant_label: row.tenantLabel,
    before_value: row.beforeValue,
    after_value: row.afterValue,
    reason: row.reason,
    status: row.status as ProposalDto["status"],
    maker_email: row.makerEmail,
    checker_email: row.checkerEmail,
    decided_reason: row.decidedReason,
    decided_at: row.decidedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}
