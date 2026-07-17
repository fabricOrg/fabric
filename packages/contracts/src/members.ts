import { z } from "zod";
import { customerRoleWireSchema } from "./identity.js";
import { membershipPermission } from "./permissions.js";

/**
 * Team-member management for a tenant (dashboard). Owners/admins invite teammates into their org.
 * `owner` is NOT invitable — it's the first admin created at tenant provisioning; new people join as
 * `admin` or `member`, with Developer Portal access assigned independently. An
 * invite creates an `invited` user + `invited` membership (bound on first sign-in) and sends a WorkOS
 * organization invitation. See docs/PI-3/ORG-PROVISIONING.md.
 */
export const inviteMemberRoleSchema = z.enum(["admin", "member"]);

export const inviteMemberRequestSchema = z.object({
  email: z.string().trim().email().max(320),
  name: z.string().trim().min(1).max(255).optional(),
  role: inviteMemberRoleSchema,
  developer_access: z.boolean().default(false),
});
export type InviteMemberRequest = z.infer<typeof inviteMemberRequestSchema>;

/**
 * Change a member's role. `owner` is not assignable here (it's singular, set at provisioning) and an
 * owner's role can't be changed through this path — see MembersService. Same role set as invite.
 */
export const updateMemberRequestSchema = z
  .object({
    role: inviteMemberRoleSchema.optional(),
    developer_access: z.boolean().optional(),
  })
  .refine(
    (value) => value.role !== undefined || value.developer_access !== undefined,
    { message: "Provide a role or developer access setting." },
  );
export type UpdateMemberRequest = z.infer<typeof updateMemberRequestSchema>;

export const memberDtoSchema = z
  .object({
    user_id: z.string(),
    email: z.string(),
    name: z.string().nullable(),
    role: customerRoleWireSchema,
    developer_access: z.boolean().optional(),
    status: z.enum(["active", "invited", "disabled"]),
    updated_at: z.string(),
    // Effective permission set (per-user override if set, else the role baseline). Drives the
    // per-user permission editor and reflects exactly what the session will carry. Present on list.
    permissions: z.array(membershipPermission).optional(),
    // True when this user has an explicit per-user override (role is no longer just its template).
    permissions_customized: z.boolean().optional(),
  })
  .transform((value) => ({
    ...value,
    role: value.role === "developer" ? ("member" as const) : value.role,
    developer_access: value.developer_access ?? value.role === "developer",
  }));
export type MemberDto = z.infer<typeof memberDtoSchema>;

export const listMembersResponseSchema = z.object({
  members: z.array(memberDtoSchema),
  /** Standard keyset cursor for the next page; null on the last page (see @app/db pagination). */
  next_cursor: z.string().nullable(),
});
export type ListMembersResponse = z.infer<typeof listMembersResponseSchema>;
