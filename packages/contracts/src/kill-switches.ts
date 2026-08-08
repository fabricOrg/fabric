import { z } from "zod";

/**
 * Kill-switch DTOs. Circuit breakers over live traffic. `enabled` = operational; toggling to false
 * PAUSES the capability. A reason (audited) is required on every toggle.
 *
 * A switch is identified by (key, tenant_id), never by key alone: `tenant_id: null` is the PLATFORM
 * breaker, a tenant id is an override scoped to one workspace. Precedence is platform OR tenant — an
 * override can pause a single tenant, never resume one past a platform halt.
 */
export const killSwitchDtoSchema = z.object({
  key: z.string(),
  /** null = the platform breaker. */
  tenant_id: z.string().uuid().nullable(),
  /** Workspace name for an override, resolved server-side. null on platform rows. */
  tenant_name: z.string().nullable(),
  /**
   * False for switches that only make sense platform-wide (`platform.signup` — the gate runs before
   * any workspace exists). The console hides the per-workspace affordance rather than offering an
   * override the runtime would never read.
   */
  tenant_scopable: z.boolean(),
  label: z.string(),
  description: z.string(),
  scope: z.string(),
  enabled: z.boolean(),
  /** True when this row is operational but the platform breaker for its key is paused. */
  overridden_by_platform: z.boolean(),
  last_reason: z.string().nullable(),
  last_actor_email: z.string().nullable(),
  updated_at: z.string(),
});
export type KillSwitchDto = z.infer<typeof killSwitchDtoSchema>;

export const listKillSwitchesResponseSchema = z.object({
  switches: z.array(killSwitchDtoSchema),
});
export type ListKillSwitchesResponse = z.infer<
  typeof listKillSwitchesResponseSchema
>;

/**
 * `tenant_id` picks WHICH switch for this key is being flipped: omitted/null = the platform breaker
 * (the pre-existing behaviour), a workspace id = that tenant's override, created on first pause.
 */
export const toggleKillSwitchRequestSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().trim().min(8).max(500),
  tenant_id: z.string().uuid().nullish(),
});
export type ToggleKillSwitchRequest = z.infer<
  typeof toggleKillSwitchRequestSchema
>;
