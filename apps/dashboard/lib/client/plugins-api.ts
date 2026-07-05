import { z } from "zod";

/**
 * Integration plugins (docs/INTEGRATIONS-PLUGIN-ARCHITECTURE.md): vendor-agnostic, hot-swappable
 * provider *instances* per capability, with enable/disable + a default + fallback order — no lock-in.
 * TODO(BFF): promote to @app/contracts + wire the real plugin registry (instances, routing rules,
 * health) in services/api. Enabling/configuring a live instance is an external/credentialed move.
 */
export const CAPABILITIES = ["sms", "whatsapp", "payment", "identity"] as const;
export type Capability = (typeof CAPABILITIES)[number];

const pluginInstanceSchema = z.object({
  id: z.string(),
  capability: z.enum(CAPABILITIES),
  vendor: z.string(),
  label: z.string(),
  enabled: z.boolean(),
  isDefault: z.boolean(),
  status: z.enum(["connected", "available", "error"]),
  mode: z.enum(["live", "sandbox"]).nullable(),
  region: z.string().nullable(),
});
export type PluginInstance = z.infer<typeof pluginInstanceSchema>;

const pluginsResponseSchema = z.object({
  instances: z.array(pluginInstanceSchema),
});

async function bff(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...init?.headers },
    ...init,
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw payload;
  return payload;
}

export async function getPlugins(): Promise<PluginInstance[]> {
  const parsed = pluginsResponseSchema.parse(
    await bff("/api/dashboard/plugins"),
  );
  return parsed.instances;
}

/** Enable/disable or make-default an instance. Mock echoes; real path re-evaluates routing rules. */
export async function updatePlugin(input: {
  id: string;
  action: "enable" | "disable" | "make-default";
}): Promise<PluginInstance> {
  return pluginInstanceSchema.parse(
    await bff("/api/dashboard/plugins", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  );
}
