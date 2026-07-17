import { z } from "zod";

/**
 * /v1/webhooks — tenant-registered webhook endpoints (finding 8). The signing secret appears
 * ONCE, in the create response; list/detail expose only its prefix.
 */

export const createWebhookEndpointRequestSchema = z.object({
  url: z
    .string()
    .url()
    .max(2000)
    .refine((u) => u.startsWith("https://") || u.startsWith("http://"), {
      message: "url must be http(s)",
    }),
  description: z.string().max(200).optional(),
});
export type CreateWebhookEndpointRequest = z.infer<
  typeof createWebhookEndpointRequestSchema
>;

export const webhookEndpointSchema = z.object({
  id: z.string().uuid(),
  url: z.string(),
  status: z.enum(["active", "disabled"]),
  description: z.string().nullable(),
  /** The environment (ADR-0004) this endpoint belongs to — only that env's events reach it. */
  env: z.enum(["sandbox", "live"]),
  /** whsec_ prefix only — the full secret is shown once at creation. */
  secret_prefix: z.string(),
  created_at: z.string(),
  health: z.object({
    pending: z.number().int().nonnegative(),
    dead: z.number().int().nonnegative(),
    last_delivered_at: z.string().nullable(),
  }),
});
export type WebhookEndpointDto = z.infer<typeof webhookEndpointSchema>;

export const createWebhookEndpointResponseSchema = webhookEndpointSchema.extend(
  {
    /** Shown ONCE. Store it — used to verify the fabric-signature header. */
    secret: z.string(),
  },
);
export type CreateWebhookEndpointResponse = z.infer<
  typeof createWebhookEndpointResponseSchema
>;

export const listWebhookEndpointsResponseSchema = z.object({
  endpoints: z.array(webhookEndpointSchema),
  request_id: z.string(),
});
export type ListWebhookEndpointsResponse = z.infer<
  typeof listWebhookEndpointsResponseSchema
>;

export const webhookDeliveryStateSchema = z.enum([
  "pending",
  "delivering",
  "delivered",
  "dead",
]);

export const webhookDeliverySchema = z.object({
  id: z.string().uuid(),
  endpoint_id: z.string().uuid(),
  event_id: z.string().uuid(),
  event_type: z.string(),
  state: webhookDeliveryStateSchema,
  attempts: z.number().int().nonnegative(),
  next_attempt_at: z.string(),
  last_attempt_at: z.string().nullable(),
  delivered_at: z.string().nullable(),
  last_error_category: z.string().nullable(),
  last_http_status: z.number().int().nullable(),
  created_at: z.string(),
});
export type WebhookDeliveryDto = z.infer<typeof webhookDeliverySchema>;

export const listWebhookDeliveriesResponseSchema = z.object({
  deliveries: z.array(webhookDeliverySchema),
  request_id: z.string(),
});
export type ListWebhookDeliveriesResponse = z.infer<
  typeof listWebhookDeliveriesResponseSchema
>;

export const replayWebhookDeliveryResponseSchema = z.object({
  delivery: webhookDeliverySchema,
  request_id: z.string(),
});
export type ReplayWebhookDeliveryResponse = z.infer<
  typeof replayWebhookDeliveryResponseSchema
>;
