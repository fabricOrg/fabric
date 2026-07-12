import { z } from "zod";

/**
 * Staff impersonation — a time-boxed, audited "view as tenant" for support/debugging. Starting and
 * stopping both write to the audit log. The sealed claim cookie is managed by the admin-console BFF;
 * these DTOs are the audit-side of the action.
 */
export const startImpersonationRequestSchema = z.object({
  // guid() not uuid(): accepts the non-RFC-version dev seed tenant id (zod v4 uuid() rejects it).
  tenant_id: z.string().guid(),
  tenant_label: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(8).max(500),
});
export type StartImpersonationRequest = z.infer<
  typeof startImpersonationRequestSchema
>;

export const stopImpersonationRequestSchema = z.object({
  tenant_id: z.string().guid(),
  tenant_label: z.string().trim().min(1).max(200),
});
export type StopImpersonationRequest = z.infer<
  typeof stopImpersonationRequestSchema
>;
