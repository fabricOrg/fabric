// Workspace -> Application -> Environment DTOs (ADR-0004). A workspace (the tenant) contains
// applications; each application has a sandbox and a live environment. Scoped resources (API keys,
// webhooks, logs, usage) reference an environment. Sandbox routing is pinned server-side on
// `environment.type` — a `sandbox` environment can never reach a real carrier.

import { z } from "zod";

export const environmentTypeSchema = z.enum(["sandbox", "live"]);
export type EnvironmentType = z.infer<typeof environmentTypeSchema>;

// `locked` = the live environment before go-live unlocks it (compliance gate, ADR-0002).
export const environmentStatusSchema = z.enum(["active", "locked"]);
export type EnvironmentStatus = z.infer<typeof environmentStatusSchema>;

export const environmentDtoSchema = z.object({
  id: z.string().uuid(),
  application_id: z.string().uuid(),
  type: environmentTypeSchema,
  status: environmentStatusSchema,
  created_at: z.string(),
});
export type EnvironmentDto = z.infer<typeof environmentDtoSchema>;

export const applicationDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  created_at: z.string(),
  // Its environments (a sandbox always; a live env that may be locked until go-live).
  environments: z.array(environmentDtoSchema),
  // Count of api keys across the application's environments (matches the keys table, incl. revoked)
  // — a more useful at-a-glance card metric than the environment count. Defaulted so a response that
  // predates the field still parses (0) rather than breaking the applications list.
  api_key_count: z.number().int().default(0),
});
export type ApplicationDto = z.infer<typeof applicationDtoSchema>;

export const listApplicationsResponseSchema = z.object({
  applications: z.array(applicationDtoSchema),
});
export type ListApplicationsResponse = z.infer<
  typeof listApplicationsResponseSchema
>;

export const createApplicationRequestSchema = z.object({
  // Human label for the application, e.g. "Checkout notifications".
  name: z.string().trim().min(1).max(80),
  // URL-safe slug, unique WITHIN the workspace. Lowercased/validated at the write boundary.
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/, "2-40 chars: a-z, 0-9, hyphen"),
});
export type CreateApplicationRequest = z.infer<
  typeof createApplicationRequestSchema
>;
