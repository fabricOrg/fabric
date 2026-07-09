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
  /** whsec_ prefix only — the full secret is shown once at creation. */
  secret_prefix: z.string(),
  created_at: z.string(),
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
