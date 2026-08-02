/**
 * Platform plugin registry client (control-plane). Staff enable/configure provider instances; the
 * product routes through what's enabled. Talks to the LIVE staff BFF route (/api/admin/plugins →
 * the api's /internal/plugins, backed by plugin_instances). A non-2xx body is the shared F8.3
 * envelope — thrown for toastApiError (parseApiError never throws). See docs/PI-5/PLUGIN-REGISTRY.md.
 */
export const CAPABILITIES = [
  "sms",
  "email",
  "whatsapp",
  "payment",
  "identity",
] as const;
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
  {
    name: string;
    label: string;
    required: boolean;
    /** Render masked. Set on anything that IS the secret, not just fields literally named apiKey. */
    secret?: boolean;
    /**
     * This field is DETERMINED by the instance's mode, so it is stated rather than asked.
     *
     * `credentialModeViolation` accepts exactly one value per mode — a live Arkesel instance requires
     * `sandbox="false"`, a sandbox one requires anything else, and SES requires `sesMode` to equal the
     * mode outright. A control with one legal position cannot help anyone; it can only be set wrong and
     * then refused. Deriving it makes the mismatch unrepresentable instead of merely rejected, which
     * also removes the switch whose filled track and left-hand knob made its own state unreadable.
     */
    derivedFromMode?: (mode: "sandbox" | "live") => string;
    /**
     * What the derived value MEANS, per mode. The stored literal is not self-explanatory — the flag is
     * `sandbox`, so a live instance stores `false`, and showing that raw under a label like "carrier
     * delivery" reads as the opposite of the truth. State the consequence; keep the literal visible
     * beside it for anyone debugging what was actually installed.
     */
    derivedNote?: (mode: "sandbox" | "live") => string;
    hint?: string;
  }[]
> = {
  arkesel: [
    { name: "apiKey", label: "API key", required: true, secret: true },
    {
      name: "sandbox",
      label: "Sandbox mode",
      required: false,
      derivedFromMode: (mode) => (mode === "live" ? "false" : "true"),
      derivedNote: (mode) =>
        mode === "live"
          ? "Off — sends reach real carriers and spend real money."
          : "On — nothing here reaches a carrier.",
    },
    {
      name: "callbackUrl",
      label: "Delivery-report URL",
      required: false,
      hint: "Optional. Without it, status stops at accepted and never reaches delivered.",
    },
  ],
  // Paystack declares `secretKey`, NOT `apiKey` — the generic fallback below would store a
  // credential the adapter cannot read. Which key belongs here follows the INSTANCE's mode: a
  // sandbox instance takes sk_test_, a live instance sk_live_.
  paystack: [
    {
      name: "secretKey",
      label: "Secret key",
      required: true,
      secret: true,
      hint: "sk_test_… on a sandbox instance, sk_live_… on a live one. The mode is enforced — a live instance refuses a test key and vice versa.",
    },
    // Public by design; masking it would imply a confidentiality it does not have.
    { name: "publicKey", label: "Public key", required: false },
  ],
  "aws-ses": [
    {
      name: "accessKeyId",
      label: "AWS access key ID",
      required: true,
      secret: true,
    },
    {
      name: "secretAccessKey",
      label: "AWS secret access key",
      required: true,
      secret: true,
    },
    { name: "region", label: "AWS region", required: true },
    {
      name: "configurationSet",
      label: "SES configuration set",
      required: true,
    },
    {
      name: "fromDomain",
      label: "Verified From domain",
      required: true,
    },
    {
      name: "snsTopicArn",
      label: "SNS event topic ARN",
      required: true,
    },
    {
      name: "sesMode",
      label: "SES mode",
      required: true,
      derivedFromMode: (mode) => mode,
      derivedNote: (mode) =>
        `Matches this ${mode} instance — SES refuses a credential that disagrees with it.`,
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
