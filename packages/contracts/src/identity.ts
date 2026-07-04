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
