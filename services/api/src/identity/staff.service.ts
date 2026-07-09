import type {
  InviteStaffRequest,
  ListStaffResponse,
  ResolveStaffSessionRequest,
  ResolveStaffSessionResponse,
  StaffDto,
  UpdateStaffRequest,
} from "@app/contracts";
import {
  clampLimit,
  decodeCursor,
  encodeCursor,
  keysetWhere,
  type ProvisioningDb,
  staffUsers,
  takePage,
} from "@app/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, asc, count, eq, ne } from "drizzle-orm";
import { invalidRequest } from "../http/api-error.js";
import { PROVISIONING_DB } from "./provisioning-db.module.js";
import {
  WORKOS_CLIENT,
  type WorkosClientProvider,
} from "./workos-client.provider.js";

/** Staff authz is role-based against the platform staff_users table — not tenant permissions. */
const STAFF_ROLE_PERMISSIONS = {
  operator: ["staff:read"],
  admin: ["staff:read", "staff:write"],
} as const;

type Tx = Parameters<Parameters<ProvisioningDb["db"]["transaction"]>[0]>[0];

/**
 * Platform staff (admin-console operators) — a flat email allowlist in staff_users, NOT tenant
 * users. Session resolution binds a WorkOS subject on first sign-in; the management methods
 * (list/invite/update/remove) are the control plane behind /internal/admin/staff.
 */
@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(
    @Inject(PROVISIONING_DB)
    private readonly provisioning: ProvisioningDb,
    @Inject(WORKOS_CLIENT)
    private readonly workosClient: WorkosClientProvider,
  ) {}

  /**
   * Resolve a WorkOS-authenticated identity to a STAFF session. Authorization is the staff_users
   * allowlist (email, provisioned out of band) — a valid WorkOS login is necessary but not
   * sufficient. On success we stamp external_subject_id (first login) + last_seen_at.
   */
  async resolveSession(
    request: ResolveStaffSessionRequest,
  ): Promise<ResolveStaffSessionResponse | null> {
    const email = request.email.trim().toLowerCase();
    return this.provisioning.db.transaction(async (tx) => {
      const [staff] = await tx
        .select({
          id: staffUsers.id,
          role: staffUsers.role,
          status: staffUsers.status,
        })
        .from(staffUsers)
        .where(eq(staffUsers.email, email))
        .limit(1);
      if (!staff || staff.status !== "active") return null;

      await tx
        .update(staffUsers)
        .set({
          externalSubjectId: request.external_user_id,
          name: request.name,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(staffUsers.id, staff.id));

      return {
        staff_user_id: staff.id,
        role: staff.role,
        permissions: [...STAFF_ROLE_PERMISSIONS[staff.role]],
        session_id: request.session_id,
      };
    });
  }

  /** List platform staff (admin-console management view). Standard keyset on (email ASC, id ASC). */
  async list(
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<ListStaffResponse> {
    const pageSize = clampLimit(opts.limit);
    const decoded = opts.cursor ? decodeCursor(opts.cursor) : null;
    const keyset = keysetWhere(
      staffUsers.email,
      staffUsers.id,
      "asc",
      decoded ? { primaryValue: decoded.primary, id: decoded.id } : null,
    );
    const rows = await this.provisioning.db
      .select({
        staff_user_id: staffUsers.id,
        email: staffUsers.email,
        name: staffUsers.name,
        role: staffUsers.role,
        status: staffUsers.status,
        externalSubjectId: staffUsers.externalSubjectId,
      })
      .from(staffUsers)
      .where(keyset)
      .orderBy(asc(staffUsers.email), asc(staffUsers.id))
      .limit(pageSize + 1);
    const { page, nextCursor } = takePage(rows, pageSize, (r) =>
      encodeCursor(r.email, r.staff_user_id),
    );
    return { staff: page.map(toDto), next_cursor: nextCursor };
  }

  /**
   * Allowlist a staff member by email (upsert), then send an org-less WorkOS invitation so a net-new
   * operator gets an onboarding email and can create a WorkOS identity. The allowlist row is the
   * source of truth for authz; the invitation is BEST-EFFORT (logged, non-fatal) because a re-invite
   * / role-change or an operator who signs in via a company SSO connection already has an identity —
   * a "user already exists" error must not fail the allowlist write. Re-inviting doubles as
   * "reinstate / change role". Staff are NOT org-scoped, so the invitation carries no organizationId.
   */
  async invite(request: InviteStaffRequest): Promise<StaffDto> {
    const email = request.email.trim().toLowerCase();
    const [staff] = await this.provisioning.db
      .insert(staffUsers)
      .values({
        email,
        name: request.name ?? null,
        role: request.role,
        status: "active",
      })
      .onConflictDoUpdate({
        target: staffUsers.email,
        set: {
          role: request.role,
          status: "active",
          ...(request.name ? { name: request.name } : {}),
          updatedAt: new Date(),
        },
      })
      .returning(RETURNING);
    if (!staff) throw new Error("Staff upsert returned no row.");

    try {
      await this.workosClient().userManagement.sendInvitation({ email });
    } catch (error) {
      // Already invited / already a WorkOS user / SSO-managed — the allowlist row still stands.
      this.logger.warn(
        `Staff WorkOS invitation for ${email} not sent: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }

    return toDto(staff);
  }

  /**
   * Change a staff member's role and/or status. Guards the last active admin: if this change would
   * leave zero active admins (demoting or suspending the last one), it's refused — otherwise no one
   * could ever manage staff again. Returns null when the id doesn't exist (→ 404 at the controller).
   */
  async update(
    id: string,
    patch: UpdateStaffRequest,
  ): Promise<StaffDto | null> {
    return this.provisioning.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ role: staffUsers.role, status: staffUsers.status })
        .from(staffUsers)
        .where(eq(staffUsers.id, id))
        .limit(1);
      if (!current) return null;

      const wasActiveAdmin =
        current.role === "admin" && current.status === "active";
      const willBeActiveAdmin =
        (patch.role ?? current.role) === "admin" &&
        (patch.status ?? current.status) === "active";
      if (wasActiveAdmin && !willBeActiveAdmin) {
        await this.assertNotLastAdmin(tx, id);
      }

      const [updated] = await tx
        .update(staffUsers)
        .set({
          ...(patch.role ? { role: patch.role } : {}),
          ...(patch.status ? { status: patch.status } : {}),
          updatedAt: new Date(),
        })
        .where(eq(staffUsers.id, id))
        .returning(RETURNING);
      return updated ? toDto(updated) : null;
    });
  }

  /** Remove a staff member (revokes access; reversible via re-invite). Guards the last active admin. */
  async remove(id: string): Promise<boolean> {
    return this.provisioning.db.transaction(async (tx) => {
      const [current] = await tx
        .select({ role: staffUsers.role, status: staffUsers.status })
        .from(staffUsers)
        .where(eq(staffUsers.id, id))
        .limit(1);
      if (!current) return false;
      if (current.role === "admin" && current.status === "active") {
        await this.assertNotLastAdmin(tx, id);
      }
      await tx.delete(staffUsers).where(eq(staffUsers.id, id));
      return true;
    });
  }

  /** Reject when `excludeId` is the only remaining active admin. */
  private async assertNotLastAdmin(tx: Tx, excludeId: string): Promise<void> {
    const rows = await tx
      .select({ others: count() })
      .from(staffUsers)
      .where(
        and(
          eq(staffUsers.role, "admin"),
          eq(staffUsers.status, "active"),
          ne(staffUsers.id, excludeId),
        ),
      );
    if (Number(rows[0]?.others ?? 0) === 0) {
      throw invalidRequest(
        "last_admin",
        "This is the last active admin — promote another admin first.",
      );
    }
  }
}

const RETURNING = {
  staff_user_id: staffUsers.id,
  email: staffUsers.email,
  name: staffUsers.name,
  role: staffUsers.role,
  status: staffUsers.status,
  externalSubjectId: staffUsers.externalSubjectId,
} as const;

function toDto(row: {
  staff_user_id: string;
  email: string;
  name: string | null;
  role: StaffDto["role"];
  status: StaffDto["status"];
  externalSubjectId: string | null;
}): StaffDto {
  const { externalSubjectId, ...rest } = row;
  return { ...rest, bound: externalSubjectId !== null };
}
