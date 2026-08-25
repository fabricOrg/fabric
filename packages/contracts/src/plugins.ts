import { z } from "zod";

/**
 * Platform plugin registry (control-plane). Staff-managed provider instances per capability with
 * enable/disable + a default + fallback order. See docs/PI-5/PLUGIN-REGISTRY.md.
 */
export const pluginCapabilities = [
  "sms",
  "email",
  "whatsapp",
  "payment",
  "identity",
] as const;

/**
 * What installing a credential answers with — deliberately NOT the instance.
 *
 * The endpoint seals the secret and returns a fingerprint plus the new version, because the
 * plaintext is never readable again: there is no GET, and the only thing any read can surface is
 * this fingerprint. The binding used to publish `pluginInstanceDtoSchema` here, so strict response
 * validation rejected a payload the endpoint had ALREADY committed — the operator saw
 * "id: expected string, received undefined" on a credential that installed fine, on the one screen
 * where a scary error invites a retry, and a retry means installing again.
 */
export const pluginCredentialAckSchema = z.object({
  /** Stable digest of the sealed secret. Same secret, same fingerprint — so it does NOT change on a
   *  rotation that reuses the key; `version` is what moves. */
  fingerprint: z.string(),
  version: z.number().int().positive(),
});
export type PluginCredentialAck = z.infer<typeof pluginCredentialAckSchema>;

export const pluginInstanceDtoSchema = z.object({
  id: z.string(),
  capability: z.enum(pluginCapabilities),
  vendor: z.string(),
  label: z.string(),
  enabled: z.boolean(),
  isDefault: z.boolean(),
  status: z.enum(["connected", "available", "error"]),
  mode: z.enum(["sandbox", "live"]),
  /**
   * Which credential is installed — a non-reversible marker, NEVER the secret or any part of it
   * (ADR-0011 §1). Null means none configured, which is why a live instance cannot be activated.
   */
  credential_fingerprint: z.string().nullable(),
});
export type PluginInstanceDto = z.infer<typeof pluginInstanceDtoSchema>;

export const pluginListResponseSchema = z.object({
  instances: z.array(pluginInstanceDtoSchema),
});
export type PluginListResponse = z.infer<typeof pluginListResponseSchema>;

export const pluginActionRequestSchema = z.object({
  id: z.string().uuid(),
  /**
   * `activate-live` is NOT `enable` (ADR-0011 §5). Enabling a sandbox instance is reversible and
   * costs nothing; putting one on a real carrier spends real money on real phones, so it is a
   * distinct, separately-audited action that refuses without validated credentials.
   */
  action: z.enum(["enable", "disable", "make-default", "activate-live"]),
});
export type PluginActionRequest = z.infer<typeof pluginActionRequestSchema>;

/**
 * Create the LIVE sibling of a catalog (sandbox) instance. Slice 3 made these separate rows keyed
 * by (tenant_id, capability, vendor, mode), so going live is a new instance with its OWN
 * credentials — not a mode flip on the sandbox row, which would silently repoint sandbox traffic.
 */
export const createLiveInstanceRequestSchema = z.object({
  vendor: z.string().trim().min(1),
  capability: z.enum(pluginCapabilities),
  label: z.string().trim().min(1).max(80).optional(),
});
export type CreateLiveInstanceRequest = z.infer<
  typeof createLiveInstanceRequestSchema
>;

/**
 * Install credentials on an instance. The values are the adapter's own `configSchema` shape (for
 * Arkesel: `apiKey`, optional `sandbox` / `callbackUrl`), validated against it before writing.
 *
 * Write-only by design: no read ever returns these, and the response carries a fingerprint only.
 */
export const configurePluginRequestSchema = z.object({
  credential: z
    .record(z.string(), z.string())
    .refine(
      (value) => Object.keys(value).length > 0,
      "At least one credential field is required.",
    ),
});
export type ConfigurePluginRequest = z.infer<
  typeof configurePluginRequestSchema
>;
