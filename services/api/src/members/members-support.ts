import {
  memberships,
  type ProvisioningDb,
  type TenantId,
  type UserId,
  users,
} from "@app/db";
import { and, eq } from "drizzle-orm";
import { notFound } from "../http/api-error.js";

export interface MembershipRow {
  userId: UserId;
  email: string;
  name: string | null;
  role: (typeof memberships.$inferSelect)["role"];
  developerAccess: boolean;
}

/** Load a membership + its user's identity, or 404. Shared by role-change / permissions / remove. */
export async function requireMembership(
  db: ProvisioningDb,
  tenantId: TenantId,
  userId: string,
): Promise<MembershipRow> {
  const [row] = await db.db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      role: memberships.role,
      developerAccess: memberships.developerAccess,
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(
      and(eq(memberships.tenantId, tenantId), eq(users.id, userId as UserId)),
    )
    .limit(1);
  if (!row) throw notFound("member_not_found", "No such member.");
  return row;
}
