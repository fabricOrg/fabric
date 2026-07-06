import {
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  type TenantId,
  tenantIdCol,
  timestamps,
  type UserId,
} from "./_shared.js";

/**
 * IDENTITY domain (B2 of the build). The root of tenancy.
 * - `accounts` = a tenant/organization. Its `id` IS the tenant_id everything else scopes to.
 * - `users`    = a human, linked to the IdP (WorkOS) by `external_subject_id`. NO password column —
 *                WorkOS owns authentication; we own authorization + profile (see IDENTITY-SSO.md).
 * - `memberships` = which users belong to which tenants, and their role. A user can be in many orgs,
 *                so the user↔tenant link lives here, not on `users`.
 */

export const accountStatus = pgEnum("account_status", [
  "active",
  "suspended",
  "closed",
]);
export const membershipRole = pgEnum("membership_role", [
  "owner",
  "admin",
  "member",
]);
export const membershipStatus = pgEnum("membership_status", [
  "active",
  "invited",
  "disabled",
]);
export const userStatus = pgEnum("user_status", [
  "active",
  "invited",
  "disabled",
]);

// A tenant / organization. `id` is the tenant_id used everywhere else.
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom().$type<TenantId>(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  workosOrganizationId: text("workos_organization_id").unique(),
  workosUpdatedAt: timestamp("workos_updated_at", { withTimezone: true }),
  status: accountStatus("status").notNull().default("active"),
  plan: text("plan").notNull().default("free"),
  // data_region drives residency (COMPLIANCE doc); validated at the app boundary.
  dataRegion: text("data_region").notNull().default("af-south-1"),
  settings: jsonb("settings").notNull().default({}),
  ...timestamps,
});

// A human. Identified across the platform by the WorkOS subject id.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom().$type<UserId>(),
  externalSubjectId: text("external_subject_id").notNull().unique(), // WorkOS `sub`
  email: text("email").notNull(),
  name: text("name"),
  status: userStatus("status").notNull().default("active"),
  workosUpdatedAt: timestamp("workos_updated_at", { withTimezone: true }),
  ...timestamps,
});

// The tenant↔user link + role. Tenant-scoped (carries tenant_id → RLS applies).
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "cascade",
    }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" })
      .$type<UserId>(),
    workosMembershipId: text("workos_membership_id").unique(),
    role: membershipRole("role").notNull().default("member"),
    status: membershipStatus("status").notNull().default("active"),
    workosUpdatedAt: timestamp("workos_updated_at", { withTimezone: true }),
    ...timestamps,
  },
  // drizzle 0.45: the 3rd pgTable arg returns an ARRAY (the object form is deprecated).
  (t) => [
    // a user has at most one membership row per tenant
    unique("uniq_membership_tenant_user").on(t.tenantId, t.userId),
  ],
);

/**
 * STAFF — Fabric's own operators (admin-console), NOT tenant users. Platform-level: no tenant_id,
 * no RLS (same shape as plugin_instances — read via the elevated provisioning connection). A staff
 * member authenticates via WorkOS like anyone else, but authorization is THIS allowlist-table, not a
 * tenant membership. Provisioned by email (may exist before first login); external_subject_id is
 * filled on first successful sign-in.
 */
export const staffRole = pgEnum("staff_role", ["operator", "admin"]);
export const staffStatus = pgEnum("staff_status", ["active", "suspended"]);

export const staffUsers = pgTable("staff_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(), // lowercased at the write boundary
  externalSubjectId: text("external_subject_id").unique(), // WorkOS `sub`, set on first login
  name: text("name"),
  role: staffRole("role").notNull().default("operator"),
  status: staffStatus("status").notNull().default("active"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  ...timestamps,
});

// Drizzle INFERS these types from the schema above — one source of truth, no drift.
// Services import these instead of redefining shapes (type safety + maintainability).
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type User = typeof users.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type StaffUser = typeof staffUsers.$inferSelect;
