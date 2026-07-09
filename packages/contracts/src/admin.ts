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

/** A tenant/account row for the staff control-plane list. Balance lives in the ledger (not joined
 *  here); data_region is what accounts actually stores (market region → residency mapping). */
export const tenantSummaryDtoSchema = z.object({
  tenant_id: z.string(),
  name: z.string(),
  slug: z.string(),
  plan: z.string(),
  status: z.enum(["active", "suspended", "closed"]),
  data_region: z.string(),
  workos_organization_id: z.string().nullable(),
  created_at: z.string(),
});
export type TenantSummaryDto = z.infer<typeof tenantSummaryDtoSchema>;

export const listTenantsResponseSchema = z.object({
  tenants: z.array(tenantSummaryDtoSchema),
  /** Standard keyset cursor for the next page; null on the last page (see @app/db pagination). */
  next_cursor: z.string().nullable(),
});
export type ListTenantsResponse = z.infer<typeof listTenantsResponseSchema>;

/**
 * Tenant lifecycle change (staff control plane). Accounts SOFT-close — `closed` is terminal (never
 * hard-delete), so the API rejects any transition out of it. `reason` is mandatory and audited
 * (before→after), matching the staff-suspend governance pattern.
 */
export const updateTenantStatusRequestSchema = z.object({
  status: z.enum(["active", "suspended", "closed"]),
  reason: z.string().trim().min(8, "Give a reason (at least 8 characters)."),
});
export type UpdateTenantStatusRequest = z.infer<
  typeof updateTenantStatusRequestSchema
>;
