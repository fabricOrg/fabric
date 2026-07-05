import { z } from "zod";

/**
 * Platform plugin registry (control-plane). Staff-managed provider instances per capability with
 * enable/disable + a default + fallback order. See docs/PI-5/PLUGIN-REGISTRY.md.
 */
export const pluginCapabilities = [
  "sms",
  "whatsapp",
  "payment",
  "identity",
] as const;

export const pluginInstanceDtoSchema = z.object({
  id: z.string(),
  capability: z.enum(pluginCapabilities),
  vendor: z.string(),
  label: z.string(),
  enabled: z.boolean(),
  isDefault: z.boolean(),
  status: z.enum(["connected", "available", "error"]),
  mode: z.enum(["sandbox", "live"]),
});
export type PluginInstanceDto = z.infer<typeof pluginInstanceDtoSchema>;

export const pluginListResponseSchema = z.object({
  instances: z.array(pluginInstanceDtoSchema),
});
export type PluginListResponse = z.infer<typeof pluginListResponseSchema>;

export const pluginActionRequestSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["enable", "disable", "make-default"]),
});
export type PluginActionRequest = z.infer<typeof pluginActionRequestSchema>;
