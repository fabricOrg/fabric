import { z } from "zod";

/**
 * Maker-checker DTOs. A maker proposes a consequential change; a different admin decides. Separation
 * of duties (maker ≠ checker) is enforced server-side.
 */
export const proposalKindSchema = z.enum([
  "wallet_adjustment",
  "plan_change",
  "refund",
  // ADR-0002 F4: customer-initiated sandbox → live request. The ONLY kind decide() EXECUTES
  // (plan flip) — the others still record intent only.
  "go_live",
]);

/** Customer-side go-live request (dashboard → BFF → api). Creates a `go_live` proposal for the
 *  admin-console queue; the tenant comes from the session, never this body. */
export const goLiveRequestSchema = z.object({
  business_name: z.string().trim().min(2).max(200),
  registration_number: z.string().trim().max(100).optional(),
  use_case: z.string().trim().min(10).max(1000),
});
export type GoLiveRequest = z.infer<typeof goLiveRequestSchema>;

export const goLiveStatusSchema = z.object({
  /** none = never requested; pending/approved/rejected mirror the proposal. */
  status: z.enum(["none", "pending", "approved", "rejected"]),
  decided_reason: z.string().nullable(),
  requested_at: z.string().nullable(),
});
export type GoLiveStatus = z.infer<typeof goLiveStatusSchema>;

export const proposalDtoSchema = z.object({
  id: z.string(),
  kind: proposalKindSchema,
  tenant_id: z.string().nullable(),
  tenant_label: z.string(),
  before_value: z.string(),
  after_value: z.string(),
  reason: z.string(),
  status: z.enum(["pending", "approved", "rejected"]),
  maker_email: z.string(),
  checker_email: z.string().nullable(),
  decided_reason: z.string().nullable(),
  decided_at: z.string().nullable(),
  created_at: z.string(),
});
export type ProposalDto = z.infer<typeof proposalDtoSchema>;

export const listProposalsResponseSchema = z.object({
  proposals: z.array(proposalDtoSchema),
  /** Standard keyset cursor field for cross-table consistency. Proposals sort compound
   *  (status, created_at) — a single-column keyset can't express that, so this stays null until a
   *  compound cursor is warranted; the pending queue is small by nature. */
  next_cursor: z.string().nullable(),
});
export type ListProposalsResponse = z.infer<typeof listProposalsResponseSchema>;

export const createProposalRequestSchema = z.object({
  kind: proposalKindSchema,
  tenant_id: z.string().uuid().nullable().optional(),
  tenant_label: z.string().trim().min(1).max(200),
  before_value: z.string().trim().max(200),
  after_value: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(8).max(500),
});
export type CreateProposalRequest = z.infer<typeof createProposalRequestSchema>;

export const decideProposalRequestSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(500).optional(),
});
export type DecideProposalRequest = z.infer<typeof decideProposalRequestSchema>;
