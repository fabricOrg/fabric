import { z } from "zod";

/**
 * Kill-switch DTOs. Platform circuit breakers. `enabled` = operational; toggling to false PAUSES the
 * capability. A reason (audited) is required on every toggle.
 */
export const killSwitchDtoSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  scope: z.string(),
  enabled: z.boolean(),
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

export const toggleKillSwitchRequestSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().trim().min(8).max(500),
});
export type ToggleKillSwitchRequest = z.infer<
  typeof toggleKillSwitchRequestSchema
>;
