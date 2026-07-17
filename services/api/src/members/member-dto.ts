import type { MemberDto } from "@app/contracts";
import { effectivePermissions } from "@app/contracts";

/**
 * Build a member DTO from a membership row. Collapses the legacy `developer` role to `member`, derives
 * developer access, and resolves the EFFECTIVE permission set (per-user override or role baseline) +
 * whether it has been customized. One place so list / role-change / permission-change agree.
 */
export function toMemberDto(input: {
  userId: string;
  email: string;
  name: string | null;
  role: string;
  developerAccess: boolean;
  status: "active" | "invited" | "disabled";
  updatedAt: Date;
  override: string[] | null;
}): MemberDto {
  const developerAccess = input.developerAccess || input.role === "developer";
  return {
    user_id: input.userId,
    email: input.email,
    name: input.name,
    role: (input.role === "developer" ? "member" : input.role) as
      | "owner"
      | "admin"
      | "member",
    developer_access: developerAccess,
    status: input.status,
    updated_at: input.updatedAt.toISOString(),
    permissions: effectivePermissions({
      role: input.role,
      developerAccess,
      override: input.override,
    }),
    permissions_customized: input.override != null,
  };
}
