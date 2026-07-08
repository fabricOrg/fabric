import { z } from "zod";

/**
 * Audit log DTOs. The append-only record of consequential staff actions, surfaced in the admin
 * console. `record` is internal (services call it); the console only reads `list`.
 */
export const auditEventDtoSchema = z.object({
  id: z.string(),
  actor_email: z.string().nullable(),
  action: z.string(),
  target_type: z.string().nullable(),
  target_id: z.string().nullable(),
  summary: z.string(),
  reason: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});
export type AuditEventDto = z.infer<typeof auditEventDtoSchema>;

export const listAuditResponseSchema = z.object({
  events: z.array(auditEventDtoSchema),
});
export type ListAuditResponse = z.infer<typeof listAuditResponseSchema>;
