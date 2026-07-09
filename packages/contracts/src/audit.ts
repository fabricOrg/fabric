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
  /** Opaque keyset cursor for the NEXT (older) page; null when this is the last page. Pass it back
   *  as `?cursor=` to continue. Keyset (not offset) so a page can't skip/duplicate rows as new
   *  audit entries land at the head while an operator scrolls. */
  next_cursor: z.string().nullable(),
});
export type ListAuditResponse = z.infer<typeof listAuditResponseSchema>;
