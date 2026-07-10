import { pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { tenantIdCol, timestamps } from "./_shared.js";

/**
 * OPT-OUT / consent registry (E10-S5, NCC 2442 DND). Tenant-scoped (RLS in the sibling raw
 * migration). PII posture mirrors messages/verifications: sha-256 hash is the enforcement key,
 * masked form is for display. Scope: "promotional" = DND (transactional still flows, per NCC);
 * "all" = the customer's own full suppression list.
 */

export const optOutScope = pgEnum("opt_out_scope", ["promotional", "all"]);
export const optOutSource = pgEnum("opt_out_source", [
  "stop",
  "registry",
  "manual",
]);

export const optOuts = pgTable(
  "opt_outs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdCol(),
    msisdnHash: text("msisdn_hash").notNull(),
    msisdnMasked: text("msisdn_masked").notNull(),
    scope: optOutScope("scope").notNull().default("promotional"),
    source: optOutSource("source").notNull().default("manual"),
    ...timestamps,
  },
  (t) => [
    // One row per (tenant, number): re-adding upgrades/downgrades scope in place.
    unique("uniq_opt_out_tenant_msisdn").on(t.tenantId, t.msisdnHash),
  ],
);

export type OptOut = typeof optOuts.$inferSelect;
