import { accounts, memberships, type ProvisioningDb, users } from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Event } from "@workos-inc/node";
import { and, eq, isNull, lte, or, type SQL } from "drizzle-orm";
import { unauthorized } from "../http/api-error.js";
import { PROVISIONING_DB } from "./provisioning-db.module.js";
import {
  WORKOS_CLIENT,
  type WorkosClientProvider,
} from "./workos-client.provider.js";

const CUSTOMER_ROLES = new Set(["owner", "admin", "member"]);

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

  private async upsertUser(
    user: { id: string; email: string; name: string | null },
    sourceUpdatedAt: Date,
  ) {
    await this.provisioning.db
      .insert(users)
      .values({
        externalSubjectId: user.id,
        email: user.email,
        name: user.name,
        status: "active",
        workosUpdatedAt: sourceUpdatedAt,
      })
      .onConflictDoUpdate({
        target: users.externalSubjectId,
        set: {
          email: user.email,
          name: user.name,
          status: "active",
          workosUpdatedAt: sourceUpdatedAt,
          updatedAt: new Date(),
        },
        setWhere: requiredCondition(
          or(
            isNull(users.workosUpdatedAt),
            lte(users.workosUpdatedAt, sourceUpdatedAt),
          ),
        ),
      });
  }

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
      let [user] = await tx
        .select({ id: users.id, status: users.status })
        .from(users)
        .where(eq(users.externalSubjectId, membership.userId))
        .limit(1);
      if (!user) {
        const remoteUser = await this.workosClient().userManagement.getUser(
          membership.userId,
        );
        await tx.insert(users).values({
          externalSubjectId: remoteUser.id,
          email: remoteUser.email,
          name: remoteUser.name,
          status: "active",
          workosUpdatedAt: new Date(remoteUser.updatedAt),
        });
        [user] = await tx
          .select({ id: users.id, status: users.status })
          .from(users)
          .where(eq(users.externalSubjectId, membership.userId))
          .limit(1);
      }
      if (!user) return;
      const status = mapMembershipStatus(membership.status);
      if (user.status === "disabled" && status !== "disabled") return;

      await tx
        .insert(memberships)
        .values({
          tenantId: account.id,
          userId: user.id,
          workosMembershipId: membership.id,
          role: membership.role.slug as "owner" | "admin" | "member",
          status,
          workosUpdatedAt: sourceUpdatedAt,
        })
        .onConflictDoUpdate({
          target: [memberships.tenantId, memberships.userId],
          set: {
            workosMembershipId: membership.id,
            role: membership.role.slug as "owner" | "admin" | "member",
            status,
            workosUpdatedAt: sourceUpdatedAt,
            updatedAt: new Date(),
          },
          setWhere: requiredCondition(
            or(
              isNull(memberships.workosUpdatedAt),
              lte(memberships.workosUpdatedAt, sourceUpdatedAt),
            ),
          ),
        });
    });
  }

  private async disableUser(
    userData: { id: string; email: string; name: string | null },
    sourceUpdatedAt: Date,
  ) {
    await this.provisioning.db.transaction(async (tx) => {
      const [disabledUser] = await tx
        .insert(users)
        .values({
          externalSubjectId: userData.id,
          email: userData.email,
          name: userData.name,
          status: "disabled",
          workosUpdatedAt: sourceUpdatedAt,
        })
        .onConflictDoUpdate({
          target: users.externalSubjectId,
          set: {
            email: userData.email,
            name: userData.name,
            status: "disabled",
            workosUpdatedAt: sourceUpdatedAt,
            updatedAt: new Date(),
          },
          setWhere: requiredCondition(
            or(
              isNull(users.workosUpdatedAt),
              lte(users.workosUpdatedAt, sourceUpdatedAt),
            ),
          ),
        })
        .returning({ id: users.id });
      if (disabledUser) {
        await tx
          .update(memberships)
          .set({ status: "disabled", updatedAt: new Date() })
          .where(eq(memberships.userId, disabledUser.id));
      }
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

function requiredCondition(condition: SQL | undefined): SQL {
  if (!condition) throw new Error("A database write condition is required.");
  return condition;
}
