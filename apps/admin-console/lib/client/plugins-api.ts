/**
 * Platform plugin registry client (control-plane). Staff enable/configure provider instances; the
 * product routes through what's enabled. Talks to the LIVE staff BFF route (/api/admin/plugins →
 * the api's /internal/plugins, backed by plugin_instances). A non-2xx body is the shared F8.3
 * envelope — thrown for toastApiError (parseApiError never throws). See docs/PI-5/PLUGIN-REGISTRY.md.
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
  /** Which credential is installed — never the secret. Null means none, so live cannot activate. */
  credential_fingerprint: string | null;
}

/**
 * The credential fields a vendor needs, mirroring each adapter's `configSchema` on the api side.
 * Kept as a small map rather than fetched: it drives form LABELS, and the api re-validates against
 * the adapter's own schema anyway — so a drift here is a UX bug, never a correctness one.
 */
export const VENDOR_CREDENTIAL_FIELDS: Record<
  string,
  { name: string; label: string; required: boolean; hint?: string }[]
> = {
  arkesel: [
    { name: "apiKey", label: "API key", required: true },
    {
      name: "sandbox",
      label: "Sandbox",
      required: false,
      hint: "'false' sends to real carriers and spends real money. Anything else stays sandboxed.",
    },
    {
      name: "callbackUrl",
      label: "Delivery-report URL",
      required: false,
      hint: "Optional. Without it, status stops at accepted and never reaches delivered.",
    },
  ],
};

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
  action: "enable" | "disable" | "make-default" | "activate-live";
}): Promise<PluginInstance> {
  return (await bff("/api/admin/plugins", {
    method: "POST",
    body: JSON.stringify(input),
  })) as PluginInstance;
}

/** Create the live sibling of a vendor. Arrives disabled, with no credentials. */
export async function createLiveInstance(input: {
  vendor: string;
  capability: Capability;
  label?: string;
}): Promise<PluginInstance> {
  return (await bff("/api/admin/plugins/live-instances", {
    method: "POST",
    body: JSON.stringify(input),
  })) as PluginInstance;
}

/**
 * Install or rotate credentials. Returns a fingerprint + version — never the secret, which is not
 * readable again from anywhere once sealed.
 */
export async function configurePlugin(
  id: string,
  credential: Record<string, string>,
): Promise<{ fingerprint: string; version: number }> {
  return (await bff(`/api/admin/plugins/${id}/credentials`, {
    method: "POST",
    body: JSON.stringify({ credential }),
  })) as { fingerprint: string; version: number };
}
