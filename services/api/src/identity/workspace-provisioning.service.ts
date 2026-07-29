import type {
  CreateWorkspaceRequest,
  CreateWorkspaceResponse,
} from "@app/contracts";
import {
  accounts,
  applications,
  environments,
  memberships,
  type ProvisioningDb,
  users,
} from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import { PROVISIONING_DB } from "./provisioning-db.module.js";
import { deriveSlug, SANDBOX_PLAN, throttled } from "./signup-shared.js";

/**
 * ADR-0007: workspace creation is a LOCAL transaction entered through the onboarding wizard —
 * no WorkOS organization is created, so the IdP is out of the workspace-creation path entirely
 * (`workos_organization_id` stays null; it is reserved for a future enterprise-SSO mapping).
 * The caller (BFF) has already authenticated the user via resolve-v2; this service only creates
 * a workspace for a user row that exists and is bound to the presented subject.
 */
@Injectable()
export class WorkspaceProvisioningService {
  constructor(
    @Inject(PROVISIONING_DB)
    private readonly provisioning: ProvisioningDb,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(KillSwitchService) private readonly killSwitch: KillSwitchService,
  ) {}

  async createWorkspace(
    request: CreateWorkspaceRequest,
  ): Promise<CreateWorkspaceResponse | null> {
    const email = request.email.trim().toLowerCase();
    const workspaceName = request.workspace_name.trim();

    // Same gates as ADR-0002 signup: live kill-switch (fails closed), verified email, throttle.
    if (!(await this.killSwitch.signupEnabled())) return null;
    if (!request.email_verified) return null;

    // The person must already exist and be bound to this subject (resolve-v2 ran first).
    const [owner] = await this.provisioning.db
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(eq(users.externalSubjectId, request.external_user_id))
      .limit(1);
    if (!owner || owner.status === "disabled") return null;

    // Double-submit replay: a same-named active workspace this user already OWNS is returned
    // instead of duplicated. Distinct names still create distinct workspaces (Stripe model).
    const [existing] = await this.provisioning.db
      .select({
        tenantId: accounts.id,
        name: accounts.name,
        slug: accounts.slug,
      })
      .from(memberships)
      .innerJoin(accounts, eq(accounts.id, memberships.tenantId))
      .where(
        and(
          eq(memberships.userId, owner.id),
          eq(memberships.role, "owner"),
          eq(memberships.status, "active"),
          eq(accounts.name, workspaceName),
          eq(accounts.status, "active"),
        ),
      )
      .limit(1);
    if (existing) {
      return {
        tenant_id: existing.tenantId,
        workspace_name: existing.name,
        workspace_slug: existing.slug,
        provisioned: false,
      };
    }

    if (throttled(email)) return null;

    // ONE local transaction: account + owner membership + default application with a sandbox
    // (active) and live (locked-until-go-live) environment — same shape as ops provisioning.
    const created = await this.provisioning.db.transaction(async (tx) => {
      const [account] = await tx
        .insert(accounts)
        .values({
          name: workspaceName,
          slug: deriveSlug(workspaceName.toLowerCase() || email),
          plan: SANDBOX_PLAN,
          status: "active",
        })
        .returning({
          id: accounts.id,
          name: accounts.name,
          slug: accounts.slug,
        });
      if (!account) throw new Error("Account insert returned no row.");

      await tx.insert(memberships).values({
        tenantId: account.id,
        userId: owner.id,
        role: "owner",
        status: "active",
      });

      const [app] = await tx
        .insert(applications)
        .values({ tenantId: account.id, name: "Default", slug: "default" })
        .returning({ id: applications.id });
      if (!app) throw new Error("Default application insert returned no row.");
      await tx.insert(environments).values([
        {
          tenantId: account.id,
          applicationId: app.id,
          type: "sandbox",
          status: "active",
        },
        {
          tenantId: account.id,
          applicationId: app.id,
          type: "live",
          status: "locked",
        },
      ]);
      return account;
    });

    await this.audit.record({
      actorStaffId: null,
      actorEmail: email,
      action: "tenant.self_serve_signup",
      targetType: "tenant",
      targetId: created.id,
      summary: `${created.name} created through onboarding (sandbox)`,
      reason: "ADR-0007 local-only workspace creation",
      metadata: {},
    });

    return {
      tenant_id: created.id,
      workspace_name: created.name,
      workspace_slug: created.slug,
      provisioned: true,
    };
  }
}
