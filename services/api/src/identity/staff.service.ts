import type {
  InviteStaffRequest,
  ListStaffResponse,
  ResolveStaffSessionRequest,
  ResolveStaffSessionResponse,
  StaffDto,
  UpdateStaffRequest,
} from "@app/contracts";
import { type ProvisioningDb, staffUsers } from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, eq, ne } from "drizzle-orm";
import { invalidRequest } from "../http/api-error.js";
import { PROVISIONING_DB } from "./provisioning-db.module.js";

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
  constructor(
    @Inject(PROVISIONING_DB)
    private readonly provisioning: ProvisioningDb,
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

  /** List all platform staff (admin-console management view). */
  async list(): Promise<ListStaffResponse> {
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
      .orderBy(asc(staffUsers.email));
    return { staff: rows.map(toDto) };
  }

  /**
   * Allowlist a staff member by email (upsert). No WorkOS call — staff aren't org-scoped; they sign
   * in with any WorkOS identity whose email matches, and resolveSession binds the subject on first
   * login. Re-inviting re-activates + updates role, so this doubles as "reinstate / change role".
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
