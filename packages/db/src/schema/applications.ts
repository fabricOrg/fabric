import { pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import {
  type ApplicationId,
  type EnvironmentId,
  tenantIdCol,
  timestamps,
} from "./_shared.js";
import { accounts } from "./identity.js";

/**
 * APPLICATIONS / ENVIRONMENTS (ADR-0004). The Workspace -> Application -> Environment hierarchy.
 *
 * - Workspace = the `accounts` row (the tenant). Unchanged as the RLS isolation boundary. "Workspace"
 *   is the product-facing name; the table stays `accounts` to avoid a high-risk rename.
 * - Application = a project within a workspace. A workspace has one or more; a DEFAULT application is
 *   auto-created at provision time. Tenant-scoped (carries tenant_id -> the existing tenant_isolation
 *   FORCE-RLS policy applies; app selection is an app-layer WHERE within the tenant, NOT a new
 *   isolation boundary).
 * - Environment = a sandbox|live environment of an application. Scoped resources (api_keys,
 *   webhook_endpoints, sender IDs, logs, usage) live under an environment. Every application gets a
 *   `sandbox` environment at creation; the `live` environment exists but is `locked` until go-live
 *   unlocks it (compliance gate, ADR-0002). Provider ROUTING pins on `environment.type` (sandbox ->
 *   fake/virtual, never a carrier) — superseding the old `accounts.plan === 'sandbox'` check.
 */

// A sandbox environment can never reach a real carrier; live is the production surface.
export const environmentType = pgEnum("environment_type", ["sandbox", "live"]);
// `locked` = exists but not usable (live before go-live). Unlocked (-> active) by the go_live gate.
export const environmentStatus = pgEnum("environment_status", [
  "active",
  "locked",
]);

// A project within a workspace. Tenant-scoped -> FORCE RLS (see the app/env RLS migration).
export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom().$type<ApplicationId>(),
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    slug: text("slug").notNull(), // unique WITHIN a workspace, not globally (see composite unique)
    ...timestamps,
  },
  (t) => [
    // slug identifies an application inside its workspace; two workspaces may reuse a slug.
    unique("uniq_application_tenant_slug").on(t.tenantId, t.slug),
  ],
);

// A sandbox|live environment of an application. Tenant-scoped for RLS; app-scoped for selection.
export const environments = pgTable(
  "environments",
  {
    id: uuid("id").primaryKey().defaultRandom().$type<EnvironmentId>(),
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "cascade",
    }),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" })
      .$type<ApplicationId>(),
    type: environmentType("type").notNull(),
    status: environmentStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    // an application has at most one environment of each type (one sandbox, one live)
    unique("uniq_environment_application_type").on(t.applicationId, t.type),
  ],
);

// Drizzle INFERS these — one source of truth, no drift.
export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;
export type Environment = typeof environments.$inferSelect;
export type NewEnvironment = typeof environments.$inferInsert;
