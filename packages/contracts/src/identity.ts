import { z } from "zod";

export const customerRoleSchema = z.enum(["owner", "admin", "member"]);

const identifier = z.string().trim().min(1).max(255);
const postgresUuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const resolveIdentitySessionRequestSchema = z.object({
  external_user_id: identifier,
  organization_id: identifier,
  email: z.string().trim().email().max(320),
  name: z.string().trim().min(1).max(255).nullable(),
  user_updated_at: z.string().datetime({ offset: true }),
  role: customerRoleSchema,
  permissions: z.array(identifier).max(100),
  session_id: identifier,
});

export type ResolveIdentitySessionRequest = z.infer<
  typeof resolveIdentitySessionRequestSchema
>;

export const resolveIdentitySessionResponseSchema = z.object({
  tenant_id: postgresUuid,
  user_id: postgresUuid,
  role: customerRoleSchema,
  permissions: z.array(identifier),
  session_id: identifier,
});

export type ResolveIdentitySessionResponse = z.infer<
  typeof resolveIdentitySessionResponseSchema
>;

// ---- Staff (platform operators) — resolved against staff_users, not a tenant membership ----------
export const staffRoleSchema = z.enum(["operator", "admin"]);

/** Staff sign-in claims. No org/role/permissions from the IdP — staff authz comes from staff_users. */
export const resolveStaffSessionRequestSchema = z.object({
  external_user_id: identifier,
  email: z.string().trim().email().max(320),
  name: z.string().trim().min(1).max(255).nullable(),
  user_updated_at: z.string().datetime({ offset: true }),
  session_id: identifier,
});

export type ResolveStaffSessionRequest = z.infer<
  typeof resolveStaffSessionRequestSchema
>;

export const resolveStaffSessionResponseSchema = z.object({
  staff_user_id: postgresUuid,
  role: staffRoleSchema,
  permissions: z.array(identifier),
  session_id: identifier,
});

export type ResolveStaffSessionResponse = z.infer<
  typeof resolveStaffSessionResponseSchema
>;
