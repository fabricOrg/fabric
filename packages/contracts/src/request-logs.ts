import { z } from "zod";

/**
 * /v1/logs — customer API request logs (W-B). Metadata only: method, path, status, latency,
 * request_id, environment, time. Never bodies, never keys. Keyset-paginated newest-first.
 */

export const requestLogSummarySchema = z.object({
  id: z.string().uuid(),
  method: z.string(),
  path: z.string(),
  status_code: z.number().int(),
  request_id: z.string(),
  latency_ms: z.number().int(),
  env: z.enum(["sandbox", "live"]),
  created_at: z.string(),
});
export type RequestLogSummary = z.infer<typeof requestLogSummarySchema>;

export const listRequestLogsResponseSchema = z.object({
  logs: z.array(requestLogSummarySchema),
  next_cursor: z.string().nullable(),
});
export type ListRequestLogsResponse = z.infer<
  typeof listRequestLogsResponseSchema
>;
