import type {
  CreateProposalRequest,
  DecideProposalRequest,
  ListProposalsResponse,
  ProposalDto,
} from "@app/contracts";
import { type ProvisioningDb, proposals } from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { asc, desc, eq } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { invalidRequest } from "../http/api-error.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";

interface Actor {
  readonly email: string;
  readonly staffId?: string | null;
}

@Injectable()
export class ProposalService {
  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(): Promise<ListProposalsResponse> {
    // Pending first, then most-recently decided.
    const rows = await this.provisioning.db
      .select()
      .from(proposals)
      .orderBy(asc(proposals.status), desc(proposals.createdAt));
    return { proposals: rows.map(toDto) };
  }

  async create(
    request: CreateProposalRequest,
    actor: Actor,
  ): Promise<ProposalDto> {
    const [created] = await this.provisioning.db
      .insert(proposals)
      .values({
        kind: request.kind,
        tenantId: request.tenant_id ?? null,
        tenantLabel: request.tenant_label,
        beforeValue: request.before_value,
        afterValue: request.after_value,
        reason: request.reason,
        status: "pending",
        makerStaffId: actor.staffId ?? null,
        makerEmail: actor.email,
      })
      .returning();
    if (!created) throw new Error("Proposal insert returned no row.");

    await this.audit.record({
      actorStaffId: actor.staffId ?? null,
      actorEmail: actor.email,
      action: "proposal.create",
      targetType: "proposal",
      targetId: created.id,
      summary: `Proposed ${request.kind} for ${request.tenant_label}`,
      reason: request.reason,
      metadata: {
        kind: request.kind,
        before: request.before_value,
        after: request.after_value,
      },
    });
    return toDto(created);
  }

  /**
   * Approve or reject a pending proposal. Enforces separation of duties: the checker must be a
   * DIFFERENT staff member than the maker. Executing an approved change is deferred (target features
   * don't exist yet) — approval records intent + audits. Returns null when the id doesn't exist.
   */
  async decide(
    id: string,
    request: DecideProposalRequest,
    actor: Actor,
  ): Promise<ProposalDto | null> {
    const [current] = await this.provisioning.db
      .select()
      .from(proposals)
      .where(eq(proposals.id, id))
      .limit(1);
    if (!current) return null;
    if (current.status !== "pending") {
      throw invalidRequest(
        "already_decided",
        "This proposal has already been decided.",
      );
    }
    if (actor.staffId && current.makerStaffId === actor.staffId) {
      throw invalidRequest(
        "separation_of_duties",
        "You can't decide your own proposal — another admin must.",
      );
    }

    const status = request.decision === "approve" ? "approved" : "rejected";
    const [updated] = await this.provisioning.db
      .update(proposals)
      .set({
        status,
        checkerStaffId: actor.staffId ?? null,
        checkerEmail: actor.email,
        decidedReason: request.reason ?? null,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(proposals.id, id))
      .returning();
    if (!updated) return null;

    await this.audit.record({
      actorStaffId: actor.staffId ?? null,
      actorEmail: actor.email,
      action: `proposal.${status}`,
      targetType: "proposal",
      targetId: id,
      summary: `${status === "approved" ? "Approved" : "Rejected"} ${current.kind} for ${current.tenantLabel}`,
      reason: request.reason ?? null,
      metadata: {
        kind: current.kind,
        before: current.beforeValue,
        after: current.afterValue,
        maker: current.makerEmail,
      },
    });
    return toDto(updated);
  }
}

function toDto(row: typeof proposals.$inferSelect): ProposalDto {
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
