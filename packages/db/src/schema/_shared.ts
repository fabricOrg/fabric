import { bigint, customType, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Shared schema primitives. Centralising these is maintainability (define a rule once) AND
 * type safety (the whole codebase reuses the same precise types).
 */

// ---- Branded types -------------------------------------------------------------------------------
// A "brand" makes two values that are both `string`/`bigint` at runtime DISTINCT at compile time,
// so you can't accidentally pass a UserId where a TenantId is expected, or raw cents where minor
// units are expected. Zero runtime cost — it's purely a compile-time tag.
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type TenantId = Brand<string, "TenantId">;
export type UserId = Brand<string, "UserId">;
export type SubjectId = Brand<string, "SubjectId">; // a data subject (recipient) — see privacy schema
export type DekId = Brand<string, "DekId">;        // a per-subject data-encryption-key id

/**
 * Money is ALWAYS integer minor units (pesewas/kobo/cents) as a JS `bigint` — never a float
 * (floats lose precision: 0.1 + 0.2 !== 0.3) and never a JS `number` for large totals.
 * Branded so "a count of segments" can't be mistaken for "an amount of money".
 */
export type MinorUnits = Brand<bigint, "MinorUnits">;

// ---- Reusable column builders --------------------------------------------------------------------

/** created_at / updated_at, timezone-aware, defaulted. Spread into every table. */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

/** A money column: bigint minor units, branded. `mode: "bigint"` returns an exact JS bigint. */
export const moneyMinor = (name: string) =>
  bigint(name, { mode: "bigint" }).$type<MinorUnits>();

/** The tenant scope column present on every tenant-owned table (drives RLS). */
export const tenantIdCol = () => uuid("tenant_id").notNull().$type<TenantId>();

/**
 * Postgres `bytea` (raw binary) column. Drizzle has no built-in bytea, so we declare one.
 * Used for encrypted blobs (ciphertext, wrapped DEKs) — binary, never logged, never plaintext.
 */
export const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});
