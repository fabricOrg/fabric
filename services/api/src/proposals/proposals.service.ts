import type {
  CreateProposalRequest,
  DecideProposalRequest,
  GoLiveRequest,
  GoLiveStatus,
  ListProposalsResponse,
  ProposalDto,
} from "@app/contracts";
import {
  accounts,
  environments,
  type ProvisioningDb,
  proposals,
} from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { invalidRequest } from "../http/api-error.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import { toProposalDto } from "./proposal-mapper.js";

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
    // Pending first, then most-recently decided — a compound (status, created_at) sort a
    // single-column keyset can't express, so this stays single-page (next_cursor: null) for the
    // cross-table field standard. The pending queue is small by nature (items awaiting a second
    // operator); revisit with a compound cursor only if decided-history volume demands it.
    const rows = await this.provisioning.db
      .select()
      .from(proposals)
      .orderBy(asc(proposals.status), desc(proposals.createdAt));
    return { proposals: rows.map(toProposalDto), next_cursor: null };
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
    return toProposalDto(created);
  }

  /**
   * Approve or reject a pending proposal. Enforces separation of duties: the checker must be a
   * DIFFERENT staff member than the maker. Executing an approved change is deferred (target features
   * don't exist yet) — approval records intent + audits. Returns null when the id doesn't exist.
   */
  /**
   * ADR-0002 F4: customer-initiated go-live. Creates a `go_live` proposal for the admin queue —
   * the requester is the maker (customer, no staffId), so ANY staff admin can decide it; the
   * separation-of-duties check still blocks staff self-decisions on staff-made proposals.
   */
  async requestGoLive(
    tenantId: string,
    request: GoLiveRequest,
    requesterEmail: string,
  ): Promise<ProposalDto> {
    const [account] = await this.provisioning.db
      .select({ name: accounts.name, plan: accounts.plan })
      .from(accounts)
      .where(eq(accounts.id, tenantId as never))
      .limit(1);
    if (!account) {
      throw invalidRequest("tenant_not_found", "No tenant with that id.");
    }
    if (account.plan !== "sandbox") {
      throw invalidRequest(
        "not_sandbox",
        "This workspace is already live.",
        "tenant_id",
      );
    }
    const [pending] = await this.provisioning.db
      .select({ id: proposals.id })
      .from(proposals)
      .where(
        and(
          eq(proposals.kind, "go_live"),
          eq(proposals.tenantId, tenantId as never),
          eq(proposals.status, "pending"),
        ),
      )
      .limit(1);
    if (pending) {
      throw invalidRequest(
        "go_live_already_requested",
        "A go-live request is already awaiting review.",
      );
    }
    const reason = [
      `Business: ${request.business_name}`,
      request.registration_number
        ? `Reg: ${request.registration_number}`
        : null,
      `Use case: ${request.use_case}`,
    ]
      .filter(Boolean)
      .join(" · ");
    const [created] = await this.provisioning.db
      .insert(proposals)
      .values({
        kind: "go_live",
        tenantId: tenantId as never,
        tenantLabel: account.name,
        beforeValue: "sandbox",
        afterValue: "free",
        reason,
        status: "pending",
        makerStaffId: null,
        makerEmail: requesterEmail,
      })
      .returning();
    if (!created) throw new Error("Go-live proposal insert returned no row.");
    await this.audit.record({
      actorStaffId: null,
      actorEmail: requesterEmail,
      action: "tenant.go_live_requested",
      targetType: "tenant",
      targetId: tenantId,
      summary: `${account.name} requested go-live`,
      reason,
      metadata: { proposal_id: created.id },
    });
    return toProposalDto(created);
  }

  /** Latest go-live request for a tenant — what the dashboard renders (none/pending/…): */
  async goLiveStatus(tenantId: string): Promise<GoLiveStatus> {
    const [latest] = await this.provisioning.db
      .select()
      .from(proposals)
      .where(
        and(
          eq(proposals.kind, "go_live"),
          eq(proposals.tenantId, tenantId as never),
        ),
      )
      .orderBy(desc(proposals.createdAt))
      .limit(1);
    if (!latest) {
      return { status: "none", decided_reason: null, requested_at: null };
    }
    return {
      status: latest.status as GoLiveStatus["status"],
      decided_reason: latest.decidedReason,
      requested_at: latest.createdAt.toISOString(),
    };
  }

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

    // F4: go_live is the FIRST kind decide() EXECUTES. ADR-0004: the functional unlock is flipping
    // the tenant's LIVE ENVIRONMENT locked→active (that is what api-keys.service gates live-key
    // minting on, and what lets live routing run). The plan flip stays as the billing-tier change
    // and keeps the request() "already live" guard meaningful. Both are guarded so a double-approve
    // race is a no-op.
    if (
      status === "approved" &&
      current.kind === "go_live" &&
      current.tenantId
    ) {
      await this.provisioning.db
        .update(accounts)
        .set({ plan: current.afterValue, updatedAt: new Date() })
        .where(
          and(
            eq(accounts.id, current.tenantId as never),
            eq(accounts.plan, "sandbox"),
          ),
        );
      // Unlock the live environment(s) for the workspace — go-live is a workspace-wide compliance
      // gate (approved sender ID + KYC), so every locked live env for the tenant becomes usable.
      await this.provisioning.db
        .update(environments)
        .set({ status: "active", updatedAt: new Date() })
        .where(
          and(
            eq(environments.tenantId, current.tenantId as never),
            eq(environments.type, "live"),
            eq(environments.status, "locked"),
          ),
        );
      await this.audit.record({
        actorStaffId: actor.staffId ?? null,
        actorEmail: actor.email,
        action: "tenant.go_live",
        targetType: "tenant",
        targetId: current.tenantId,
        summary: `${current.tenantLabel} went LIVE (sandbox → ${current.afterValue})`,
        reason: request.reason ?? null,
        metadata: { proposal_id: id, maker: current.makerEmail },
      });
    }

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
    return toProposalDto(updated);
  }
}
