import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  type ApplicationId,
  type EnvironmentId,
  tenantIdCol,
  timestamps,
  type UserId,
} from "./_shared.js";
import { applications, environments } from "./applications.js";
import { accounts } from "./identity.js";

/**
 * MANAGED MESSAGE DEFINITIONS (SDK-003, ADR-0005 / architecture-plan §Data Model + §Invariants).
 *
 * A definition is an application-owned, stable-keyed contract ("order.shipped"). Its content lives in
 * IMMUTABLE versions; each environment points at exactly one released version. Promoting to live moves
 * the exact tested version rather than copying editable content (ADR-0005 #2).
 *
 * Ownership boundary and the invariants enforced here (see docs/sdk/managed-messaging-architecture-plan.md
 * and docs/sdk/sdk-003-slice0-design.md):
 * - stable key belongs to ONE application: UNIQUE (tenant_id, application_id, lower(key));
 * - published content NEVER changes: version rows are insert-only for the runtime role (no UPDATE/DELETE
 *   GRANT in the RLS migration — enforced by the database, not app code);
 * - version ordinal is unambiguous: UNIQUE (definition_id, version);
 * - one active release per definition/environment: UNIQUE (tenant_id, environment_id, definition_id);
 * - a release cannot cross application/tenant/definition: composite containment FKs carry all of them.
 *
 * Tenant-scoped -> FORCE RLS (see the message-definitions RLS migration). Runtime reads still include
 * application + environment predicates even though RLS remains the workspace isolation boundary.
 */

// draft -> active (has >=1 published version) -> archived (soft, never deleted). The stable key is
// immutable once any version exists; a "rename" is a new definition, not an update.
export const messageDefinitions = pgTable(
  "message_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "cascade",
    }),
    // No single-column FK to applications: the composite (application_id, tenant_id) FK below is the
    // referential guarantee (it also proves same-tenant ownership).
    applicationId: uuid("application_id").notNull().$type<ApplicationId>(),
    key: text("key").notNull(),
    status: text("status").notNull().default("draft"),
    ...timestamps,
  },
  (t) => [
    // Stable key is unique within an application, case-insensitively (generated catalog namespaces
    // must not collide Order.Shipped vs order.shipped). Persist as given; enforce on lower(key).
    uniqueIndex("uniq_message_def_tenant_app_key").on(
      t.tenantId,
      t.applicationId,
      sql`lower(${t.key})`,
    ),
    // Containment anchor so version/release composite FKs prove same-tenant/same-application ownership.
    uniqueIndex("uniq_message_def_id_tenant_app").on(
      t.id,
      t.tenantId,
      t.applicationId,
    ),
    check(
      "message_definitions_status_check",
      sql`${t.status} IN ('draft', 'active', 'archived')`,
    ),
    foreignKey({
      columns: [t.applicationId, t.tenantId],
      foreignColumns: [applications.id, applications.tenantId],
      name: "message_definitions_application_tenant_fk",
    }).onDelete("cascade"),
  ],
);

// Immutable published content. No updatedAt: a version never changes after insert. Editing content or
// the schema creates a NEW version (compatible) or a new definition (breaking) — never an UPDATE here.
export const messageDefinitionVersions = pgTable(
  "message_definition_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "cascade",
    }),
    // No single-column FK to message_definitions: the composite (definition_id, tenant_id,
    // application_id) FK below is the referential guarantee and enforces same-tenant containment.
    definitionId: uuid("definition_id").notNull(),
    applicationId: uuid("application_id").notNull().$type<ApplicationId>(),
    version: integer("version").notNull(),
    // Portable, closed JSON-Schema subset (docs/sdk/sdk-003-slice0-design.md §2). Validated + compiled
    // to zod at the API boundary; never executed.
    variableSchema: jsonb("variable_schema").notNull(),
    // SMS variant content + locale rules. Rendered server-side; the renderer is the single source both
    // preview (SDK-003) and managed send (SDK-005) consume.
    content: jsonb("content").notNull(),
    defaultLocale: text("default_locale").notNull(),
    createdBy: uuid("created_by").$type<UserId>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("uniq_message_def_version_ordinal").on(
      t.definitionId,
      t.version,
    ),
    // Containment anchor for the release -> version composite FK (same tenant + definition).
    uniqueIndex("uniq_message_def_version_id_tenant_def").on(
      t.id,
      t.tenantId,
      t.definitionId,
    ),
    check("message_def_version_positive_check", sql`${t.version} > 0`),
    foreignKey({
      columns: [t.definitionId, t.tenantId, t.applicationId],
      foreignColumns: [
        messageDefinitions.id,
        messageDefinitions.tenantId,
        messageDefinitions.applicationId,
      ],
      name: "message_def_version_definition_containment_fk",
    }).onDelete("cascade"),
  ],
);

// One row per (environment, definition): the environment's pointer to the released immutable version.
// Re-releasing updates version_id; promoting sandbox->live inserts/updates the live environment's row.
export const messageDefinitionReleases = pgTable(
  "message_definition_releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "cascade",
    }),
    applicationId: uuid("application_id").notNull().$type<ApplicationId>(),
    environmentId: uuid("environment_id").notNull().$type<EnvironmentId>(),
    definitionId: uuid("definition_id").notNull(),
    versionId: uuid("version_id").notNull(),
    ...timestamps,
  },
  (t) => [
    // One active release per definition per environment.
    uniqueIndex("uniq_message_def_release_env_definition").on(
      t.tenantId,
      t.environmentId,
      t.definitionId,
    ),
    // Hot path: resolve the released definition by environment + stable key (join through definition).
    uniqueIndex("uniq_message_def_release_id_tenant").on(t.id, t.tenantId),
    // Release cannot cross application/tenant: the definition is owned by (tenant, application)...
    foreignKey({
      columns: [t.definitionId, t.tenantId, t.applicationId],
      foreignColumns: [
        messageDefinitions.id,
        messageDefinitions.tenantId,
        messageDefinitions.applicationId,
      ],
      name: "message_def_release_definition_containment_fk",
    }).onDelete("cascade"),
    // ...the environment belongs to the same (tenant, application)...
    foreignKey({
      columns: [t.environmentId, t.applicationId, t.tenantId],
      foreignColumns: [
        environments.id,
        environments.applicationId,
        environments.tenantId,
      ],
      name: "message_def_release_environment_containment_fk",
    }).onDelete("cascade"),
    // ...and the pinned version belongs to the same (tenant, definition). Together these make a
    // cross-application or cross-tenant release impossible at the database level.
    foreignKey({
      columns: [t.versionId, t.tenantId, t.definitionId],
      foreignColumns: [
        messageDefinitionVersions.id,
        messageDefinitionVersions.tenantId,
        messageDefinitionVersions.definitionId,
      ],
      name: "message_def_release_version_containment_fk",
    }).onDelete("cascade"),
  ],
);

export type MessageDefinition = typeof messageDefinitions.$inferSelect;
export type NewMessageDefinition = typeof messageDefinitions.$inferInsert;
export type MessageDefinitionVersion =
  typeof messageDefinitionVersions.$inferSelect;
export type NewMessageDefinitionVersion =
  typeof messageDefinitionVersions.$inferInsert;
export type MessageDefinitionRelease =
  typeof messageDefinitionReleases.$inferSelect;
export type NewMessageDefinitionRelease =
  typeof messageDefinitionReleases.$inferInsert;
