import type {
  ListTenantsResponse,
  ProvisionTenantRequest,
  ProvisionTenantResponse,
  TenantSummaryDto,
  UpdateSandboxAllowancePolicy,
  UpdateTenantStatusRequest,
} from "@app/contracts";
import {
  accounts,
  applications,
  clampLimit,
  decodeCursor,
  encodeCursor,
  environments,
  keysetWhere,
  memberships,
  type ProvisioningDb,
  type TenantId,
  takePage,
  users,
} from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { desc, eq } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { invalidRequest, notFound } from "../http/api-error.js";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import {
  WORKOS_CLIENT,
  type WorkosClientProvider,
} from "../identity/workos-client.provider.js";
import {
  type AllowanceActor,
  getTenantSandboxAllowancePolicy,
  setTenantSandboxAllowancePolicy,
} from "./tenant-sandbox-allowances.js";

interface Actor extends AllowanceActor {
  readonly staffId?: string | null;
  readonly email?: string | null;
}

/**
 * Ops-provisioned tenant onboarding (docs/PI-3/ORG-PROVISIONING.md, amended by ADR-0007):
 *   1) insert the accounts row + first-admin invite rows in ONE local transaction (no WorkOS org —
 *      tenancy lives only in Fabric; workos_organization_id stays null, reserved for future SSO)
 *   2) send the org-less WorkOS invitation email  (external write — sends a real email)
 * The invitation is best-effort AFTER the rows exist: a mail hiccup leaves a valid tenant the
 * operator can re-invite into, instead of an orphaned IdP org.
 */
@Injectable()
export class TenantProvisioningService {
  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
    @Inject(WORKOS_CLIENT) private readonly workosClient: WorkosClientProvider,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  async sandboxAllowancePolicy(tenantId: string) {
    return getTenantSandboxAllowancePolicy(
      this.provisioning,
      this.config,
      tenantId,
    );
  }

  async updateSandboxAllowancePolicy(
    tenantId: string,
    request: UpdateSandboxAllowancePolicy,
    actor: Actor,
  ) {
    return setTenantSandboxAllowancePolicy(
      this.provisioning,
      this.config,
      this.audit,
      tenantId,
      request,
      actor,
    );
  }

  /**
   * Change a tenant's lifecycle status (suspend / reinstate / soft-close). Staff-gated at the BFF.
   * `closed` is TERMINAL (accounts soft-close, never hard-delete) — a transition out of it is
   * rejected. A no-op (same status) is rejected too. Every change is audited before→after + reason,
   * matching the staff-suspend governance pattern. Direct + audited, NOT maker-checker: maker-checker
   * decide() records intent but does not execute, so routing status here through it would be a dead
   * action — dual-control on tenant status is a separate epic (make decide() apply changes).
   */
  async updateStatus(
    tenantId: string,
    request: UpdateTenantStatusRequest,
    actor: Actor,
  ): Promise<TenantSummaryDto> {
    const [current] = await this.provisioning.db
      .select({ status: accounts.status, name: accounts.name })
      .from(accounts)
      .where(eq(accounts.id, tenantId as TenantId))
      .limit(1);
    if (!current) {
      throw notFound("tenant_not_found", "No tenant with that id.");
    }
    if (current.status === "closed") {
      throw invalidRequest(
        "tenant_closed",
        "This account is closed (soft-close is terminal) and can't change status.",
      );
    }
    if (current.status === request.status) {
      throw invalidRequest(
        "no_status_change",
        `The account is already ${request.status}.`,
      );
    }

    const [updated] = await this.provisioning.db
      .update(accounts)
      .set({ status: request.status, updatedAt: new Date() })
      .where(eq(accounts.id, tenantId as TenantId))
      .returning({
        tenant_id: accounts.id,
        name: accounts.name,
        slug: accounts.slug,
        plan: accounts.plan,
        status: accounts.status,
        data_region: accounts.dataRegion,
        workos_organization_id: accounts.workosOrganizationId,
        price_book_id: accounts.priceBookId,
        billing_currency: accounts.billingCurrency,
        created_at: accounts.createdAt,
      });
    if (!updated) throw new Error("tenant status update returned no row");

    await this.audit.record({
      actorStaffId: actor.staffId ?? null,
      actorEmail: actor.email ?? null,
      action: "tenant.status_change",
      targetType: "tenant",
      targetId: tenantId,
      summary: `${current.name} ${request.status === "closed" ? "CLOSED" : request.status}`,
      reason: request.reason,
      metadata: { before: current.status, after: request.status },
    });

    return { ...updated, created_at: updated.created_at.toISOString() };
  }

  /** Staff control-plane list of every account. Runs on the provisioning connection (cross-tenant).
   *  Standard keyset pagination on (created_at DESC, id DESC). */
  async list(
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<ListTenantsResponse> {
    const pageSize = clampLimit(opts.limit);
    const decoded = opts.cursor ? decodeCursor(opts.cursor) : null;
    const keyset = keysetWhere(
      accounts.createdAt,
      accounts.id,
      "desc",
      decoded
        ? { primaryValue: new Date(decoded.primary), id: decoded.id }
        : null,
    );
    const rows = await this.provisioning.db
      .select({
        tenant_id: accounts.id,
        name: accounts.name,
        slug: accounts.slug,
        plan: accounts.plan,
        status: accounts.status,
        data_region: accounts.dataRegion,
        workos_organization_id: accounts.workosOrganizationId,
        price_book_id: accounts.priceBookId,
        billing_currency: accounts.billingCurrency,
        created_at: accounts.createdAt,
      })
      .from(accounts)
      .where(keyset)
      .orderBy(desc(accounts.createdAt), desc(accounts.id))
      .limit(pageSize + 1);
    const { page, nextCursor } = takePage(rows, pageSize, (r) =>
      encodeCursor(r.created_at.toISOString(), r.tenant_id),
    );
    return {
      tenants: page.map((r) => ({
        ...r,
        created_at: r.created_at.toISOString(),
      })),
      next_cursor: nextCursor,
    };
  }

  async provision(
    request: ProvisionTenantRequest,
  ): Promise<ProvisionTenantResponse> {
    const adminEmail = request.adminEmail.trim().toLowerCase();
    // Account + the first admin's Fabric invite are written atomically: a pending `invited` user
    // (external_subject_id filled on first login) and an `invited` owner membership. This is what
    // makes access invite-only — resolve-v2 binds/activates this row and an identity with no
    // membership sees no workspace. The WorkOS invitation alone grants nothing on the Fabric side.
    const account = await this.provisioning.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(accounts)
        .values({
          name: request.name,
          slug: request.slug,
          plan: request.plan,
          dataRegion: request.dataRegion,
          status: "active",
        })
        .returning({ id: accounts.id });
      if (!created) throw new Error("Account insert returned no row.");

      // Reuse an existing human if this email was already invited to another org (users.email is
      // unique — one row per person, many memberships).
      await tx
        .insert(users)
        .values({ email: adminEmail, status: "invited" })
        .onConflictDoNothing({ target: users.email });
      const [admin] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, adminEmail))
        .limit(1);
      if (!admin) throw new Error("Admin user upsert returned no row.");

      // Idempotent: re-provisioning the same admin leaves any existing membership untouched.
      await tx
        .insert(memberships)
        .values({
          tenantId: created.id,
          userId: admin.id,
          role: "owner",
          status: "invited",
        })
        .onConflictDoNothing({
          target: [memberships.tenantId, memberships.userId],
        });

      // ADR-0004: same workspace birth as the self-serve path — a default application + a sandbox
      // environment and a live environment. Ops provisioning is the ENTERPRISE EXCEPTION (a human
      // operator deliberately onboards the tenant), and its plans are all live-eligible
      // ('free'|'growth'|'scale' — never 'sandbox'), so the live env is active immediately rather
      // than locked-until-go-live. Idempotent: re-provisioning leaves an existing default app be.
      const [app] = await tx
        .insert(applications)
        .values({ tenantId: created.id, name: "Default", slug: "default" })
        .onConflictDoNothing({
          target: [applications.tenantId, applications.slug],
        })
        .returning({ id: applications.id });
      if (app) {
        await tx.insert(environments).values([
          {
            tenantId: created.id,
            applicationId: app.id,
            type: "sandbox",
            status: "active",
          },
          {
            tenantId: created.id,
            applicationId: app.id,
            type: "live",
            status: "active",
          },
        ]);
      }

      return created;
    });

    // Best-effort AFTER the rows exist (ADR-0007): a mail hiccup leaves a valid tenant the
    // operator can re-invite into via team management, not an orphaned IdP org.
    await this.workosClient()
      .userManagement.sendInvitation({ email: adminEmail })
      .catch(() => undefined);

    return {
      tenant_id: account.id,
      workos_organization_id: null,
      slug: request.slug,
      invited_email: request.adminEmail,
    };
  }
}
