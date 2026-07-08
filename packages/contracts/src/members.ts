import { z } from "zod";
import { customerRoleSchema } from "./identity.js";

/**
 * Team-member management for a tenant (dashboard). Owners/admins invite teammates into their org.
 * `owner` is NOT invitable — it's the first admin created at tenant provisioning; new people join as
 * `admin`, `member`, or `developer` (API-focused: dev-portal access, no SMS/org-management). An
 * invite creates an `invited` user + `invited` membership (bound on first sign-in) and sends a WorkOS
 * organization invitation. See docs/PI-3/ORG-PROVISIONING.md.
 */
export const inviteMemberRoleSchema = z.enum(["admin", "member", "developer"]);

export const inviteMemberRequestSchema = z.object({
  email: z.string().trim().email().max(320),
  name: z.string().trim().min(1).max(255).optional(),
  role: inviteMemberRoleSchema,
});
export type InviteMemberRequest = z.infer<typeof inviteMemberRequestSchema>;

/**
 * Change a member's role. `owner` is not assignable here (it's singular, set at provisioning) and an
 * owner's role can't be changed through this path — see MembersService. Same role set as invite.
 */
export const updateMemberRequestSchema = z.object({
  role: inviteMemberRoleSchema,
});
export type UpdateMemberRequest = z.infer<typeof updateMemberRequestSchema>;

export const memberDtoSchema = z.object({
  user_id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  role: customerRoleSchema,
  status: z.enum(["active", "invited", "disabled"]),
});
export type MemberDto = z.infer<typeof memberDtoSchema>;

export const listMembersResponseSchema = z.object({
  members: z.array(memberDtoSchema),
});
export type ListMembersResponse = z.infer<typeof listMembersResponseSchema>;
