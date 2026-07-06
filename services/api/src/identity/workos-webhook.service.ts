import { accounts, memberships, type ProvisioningDb, users } from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Event } from "@workos-inc/node";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { unauthorized } from "../http/api-error.js";
import { PROVISIONING_DB } from "./provisioning-db.module.js";
import {
  WORKOS_CLIENT,
  type WorkosClientProvider,
} from "./workos-client.provider.js";

const CUSTOMER_ROLES = new Set(["owner", "admin", "member"]);

// The transaction handle drizzle hands to the `.transaction()` callback — reconcileUser only ever
// runs inside one (a tx lacks the top-level connection's `$client`, so we can't reuse the db type).
type Tx = Parameters<Parameters<ProvisioningDb["db"]["transaction"]>[0]>[0];

@Injectable()
export class WorkosWebhookService {
  constructor(
    @Inject(PROVISIONING_DB)
    private readonly provisioning: ProvisioningDb,
    @Inject(WORKOS_CLIENT)
    private readonly workosClient: WorkosClientProvider,
    @Inject(ConfigService)
    private readonly config: ConfigService,
  ) {}

  async ingest(payload: Buffer, signature: string): Promise<void> {
    const secret = this.config.get<string>("WORKOS_WEBHOOK_SECRET");
    if (!secret) throw new Error("WORKOS_WEBHOOK_SECRET is required.");

    let event: Event;
    try {
      event = await this.workosClient().webhooks.constructEvent({
        payload,
        sigHeader: signature,
        secret,
      });
    } catch {
      throw unauthorized(
        "invalid_workos_signature",
        "A valid WorkOS signature is required.",
      );
    }
    await this.apply(event);
  }

  async apply(event: Event): Promise<void> {
    switch (event.event) {
      case "user.created":
      case "user.updated":
        await this.upsertUser(event.data, new Date(event.data.updatedAt));
        return;
      case "user.deleted":
        await this.disableUser(event.data, new Date(event.createdAt));
        return;
      case "organization_membership.created":
      case "organization_membership.updated":
        await this.syncMembership(event.data);
        return;
      case "organization_membership.deleted":
        await this.syncMembership({
          ...event.data,
          status: "inactive",
          updatedAt: event.createdAt,
        });
        return;
      case "organization.updated":
        await this.updateOrganization(
          event.data.id,
          event.data.name,
          "active",
          new Date(event.data.updatedAt),
        );
        return;
      case "organization.deleted":
        await this.updateOrganization(
          event.data.id,
          event.data.name,
          "closed",
          new Date(event.createdAt),
        );
        return;
      default:
        return;
    }
  }

  /**
   * Reconcile the local users row for a WorkOS subject, honouring the invite-only model and the
   * unique email:
   *   - bound row (by subject) → refresh profile under the monotonic guard;
   *   - pre-invited row (matched by email, subject still null) → bind this subject to it;
   *   - email already bound to a DIFFERENT subject → refuse (never silently reassign an identity);
   *   - no row → insert only when `create` (webhook user.* events materialise a profile; a bare user
   *     row grants nothing without a membership, so this is safe. Deletes never create.)
   */
  private async reconcileUser(
    tx: Tx,
    remote: { id: string; email: string; name: string | null },
    status: "active" | "disabled",
    sourceUpdatedAt: Date,
    create: boolean,
  ): Promise<{ id: (typeof users.$inferSelect)["id"] } | null> {
    const email = remote.email.trim().toLowerCase();

    const [bound] = await tx
      .select({ id: users.id, workosUpdatedAt: users.workosUpdatedAt })
      .from(users)
      .where(eq(users.externalSubjectId, remote.id))
      .limit(1);
    if (bound) {
      if (!bound.workosUpdatedAt || bound.workosUpdatedAt <= sourceUpdatedAt) {
        await tx
          .update(users)
          .set({
            email,
            name: remote.name,
            status,
            workosUpdatedAt: sourceUpdatedAt,
            updatedAt: new Date(),
          })
          .where(eq(users.id, bound.id));
      }
      return { id: bound.id };
    }

    const [byEmail] = await tx
      .select({ id: users.id, externalSubjectId: users.externalSubjectId })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (byEmail) {
      if (byEmail.externalSubjectId) return null; // bound to another identity
      await tx
        .update(users)
        .set({
          externalSubjectId: remote.id,
          name: remote.name,
          status,
          workosUpdatedAt: sourceUpdatedAt,
          updatedAt: new Date(),
        })
        .where(eq(users.id, byEmail.id));
      return { id: byEmail.id };
    }

    if (!create) return null;
    const [created] = await tx
      .insert(users)
      .values({
        externalSubjectId: remote.id,
        email,
        name: remote.name,
        status,
        workosUpdatedAt: sourceUpdatedAt,
      })
      .returning({ id: users.id });
    return created ?? null;
  }

  private async upsertUser(
    user: { id: string; email: string; name: string | null },
    sourceUpdatedAt: Date,
  ) {
    await this.provisioning.db.transaction(async (tx) => {
      await this.reconcileUser(tx, user, "active", sourceUpdatedAt, true);
    });
  }

  /**
   * Reconcile a WorkOS org membership into Fabric — UPDATE-ONLY. The dashboard is invite-only, so
   * Fabric admin-console provisioning is the source of truth for WHO is a member: a membership must
   * already exist (created invited by tenant provisioning). We activate/deactivate/re-role it from
   * WorkOS, but a WorkOS-side org add for someone Fabric never invited grants NOTHING.
   */
  private async syncMembership(membership: {
    id: string;
    organizationId: string;
    userId: string;
    status: "active" | "inactive" | "pending";
    role: { slug: string };
    updatedAt: string;
  }) {
    if (!CUSTOMER_ROLES.has(membership.role.slug)) return;
    const [account] = await this.provisioning.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.workosOrganizationId, membership.organizationId))
      .limit(1);
    if (!account) return;

    const sourceUpdatedAt = new Date(membership.updatedAt);
    await this.provisioning.db.transaction(async (tx) => {
      // Bind the subject to a pre-invited user, but do NOT create one for an unknown identity.
      const remoteUser = await this.workosClient().userManagement.getUser(
        membership.userId,
      );
      const user = await this.reconcileUser(
        tx,
        remoteUser,
        "active",
        new Date(remoteUser.updatedAt),
        false,
      );
      if (!user) return; // not invited into Fabric → ignore the WorkOS-side membership

      const [existing] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, account.id),
            eq(memberships.userId, user.id),
          ),
        )
        .limit(1);
      if (!existing) return; // no Fabric invite for this member → grant nothing

      await tx
        .update(memberships)
        .set({
          workosMembershipId: membership.id,
          role: membership.role.slug as "owner" | "admin" | "member",
          status: mapMembershipStatus(membership.status),
          workosUpdatedAt: sourceUpdatedAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(memberships.id, existing.id),
            or(
              isNull(memberships.workosUpdatedAt),
              lte(memberships.workosUpdatedAt, sourceUpdatedAt),
            ),
          ),
        );
    });
  }

  private async disableUser(
    userData: { id: string; email: string; name: string | null },
    sourceUpdatedAt: Date,
  ) {
    await this.provisioning.db.transaction(async (tx) => {
      // create=false: a delete for a user Fabric never knew about is a no-op.
      const user = await this.reconcileUser(
        tx,
        userData,
        "disabled",
        sourceUpdatedAt,
        false,
      );
      if (!user) return;
      await tx
        .update(memberships)
        .set({ status: "disabled", updatedAt: new Date() })
        .where(eq(memberships.userId, user.id));
    });
  }

  private async updateOrganization(
    organizationId: string,
    name: string,
    status: "active" | "closed",
    sourceUpdatedAt: Date,
  ) {
    await this.provisioning.db
      .update(accounts)
      .set({
        name,
        status,
        workosUpdatedAt: sourceUpdatedAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(accounts.workosOrganizationId, organizationId),
          or(
            isNull(accounts.workosUpdatedAt),
            lte(accounts.workosUpdatedAt, sourceUpdatedAt),
          ),
        ),
      );
  }
}

function mapMembershipStatus(
  status: "active" | "inactive" | "pending",
): "active" | "invited" | "disabled" {
  if (status === "active") return "active";
  if (status === "pending") return "invited";
  return "disabled";
}
