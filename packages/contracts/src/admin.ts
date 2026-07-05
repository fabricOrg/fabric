import { z } from "zod";

/**
 * Ops-provisioned tenant onboarding. A staff operator provisions a new org:
 * WorkOS organization → `accounts` row (with workos_organization_id) → first-admin invite.
 * See docs/PI-3/ORG-PROVISIONING.md.
 */
export const provisionTenantRequestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{2,}$/, "Lower-case letters, numbers and dashes only."),
  plan: z.enum(["free", "growth", "scale"]),
  adminEmail: z.string().trim().email(),
  adminName: z.string().trim().min(1).max(120).optional(),
  // Data-residency region for the account (see accounts.dataRegion). Defaults to the launch region.
  dataRegion: z.string().trim().min(2).default("af-south-1"),
});
export type ProvisionTenantRequest = z.infer<
  typeof provisionTenantRequestSchema
>;

export const provisionTenantResponseSchema = z.object({
  tenant_id: z.string(),
  workos_organization_id: z.string(),
  slug: z.string(),
  invited_email: z.string(),
});
export type ProvisionTenantResponse = z.infer<
  typeof provisionTenantResponseSchema
>;
