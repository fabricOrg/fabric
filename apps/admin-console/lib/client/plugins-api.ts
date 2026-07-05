/**
 * Platform plugin registry client (control-plane). Staff enable/configure provider instances; the
 * product routes through what's enabled. TODO(BFF): wire the real staff endpoint GET/POST
 * /internal/plugins in services/api (backed by plugin_instances). See docs/PI-5/PLUGIN-REGISTRY.md.
 */
export const CAPABILITIES = ["sms", "whatsapp", "payment", "identity"] as const;
export type Capability = (typeof CAPABILITIES)[number];

export interface PluginInstance {
  id: string;
  capability: Capability;
  vendor: string;
  label: string;
  enabled: boolean;
  isDefault: boolean;
  status: "connected" | "available" | "error";
  mode: "sandbox" | "live" | null;
  region: string | null;
}

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
  const { instances } = (await bff("/api/admin/plugins")) as {
    instances: PluginInstance[];
  };
  return instances;
}

export async function updatePlugin(input: {
  id: string;
  action: "enable" | "disable" | "make-default";
}): Promise<PluginInstance> {
  return (await bff("/api/admin/plugins", {
    method: "POST",
    body: JSON.stringify(input),
  })) as PluginInstance;
}
