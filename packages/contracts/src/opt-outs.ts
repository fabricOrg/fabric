// Opt-out / consent registry shapes (E10-S5 / NCC 2442 DND). Scope semantics:
//   - "promotional": DND — promotional traffic is blocked, transactional still flows (NCC).
//   - "all": full suppression (customer's own do-not-contact list) — everything is blocked.

import { z } from "zod";

export const optOutScopeSchema = z.enum(["promotional", "all"]);
export const optOutSourceSchema = z.enum(["stop", "registry", "manual"]);

export const optOutDtoSchema = z.object({
  id: z.string().uuid(),
  /** Masked E.164 — the raw number never leaves the vault posture. */
  msisdn: z.string(),
  scope: optOutScopeSchema,
  source: optOutSourceSchema,
  created_at: z.string(),
});
export type OptOutDto = z.infer<typeof optOutDtoSchema>;

export const listOptOutsResponseSchema = z.object({
  opt_outs: z.array(optOutDtoSchema),
});
export type ListOptOutsResponse = z.infer<typeof listOptOutsResponseSchema>;

export const createOptOutRequestSchema = z.object({
  msisdn: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,14}$/, "must be E.164"),
  scope: optOutScopeSchema.default("promotional"),
});
export type CreateOptOutRequest = z.infer<typeof createOptOutRequestSchema>;
