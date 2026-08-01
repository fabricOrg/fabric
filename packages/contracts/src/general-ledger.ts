import { z } from "zod";
import { currency } from "./money.js";

/**
 * CORPORATE GENERAL LEDGER contracts (ADR-0013). Shapes only — the posting POLICY (which subledger
 * kind maps to which company account, and how an event becomes a journal) lives in `@app/domain`.
 *
 * Amounts travel as decimal-integer STRINGS, per the money convention: bigint does not survive JSON,
 * and a bare number would invite rounding. Consumers parse `BigInt(...)` for arithmetic.
 */

/** Postgres `bigint` upper bound — the column's real limit, enforced here so it fails as a contract
 * error rather than a raw 22003 from inside the poster's retry loop. */
const MAX_BIGINT = 9223372036854775807n;

const positiveMinorUnits = z
  .string()
  // No leading zeros: "0005" and "5" must not be two spellings of one amount, or an idempotency
  // fingerprint computed over the request body would differ for identical money.
  .regex(/^(0|[1-9]\d*)$/, "amount_minor must be a canonical integer string")
  .refine(
    (value) => BigInt(value) > 0n,
    "amount_minor must be greater than zero",
  )
  .refine(
    (value) => BigInt(value) <= MAX_BIGINT,
    "amount_minor exceeds the maximum storable amount",
  );

/**
 * The tenant subledger's account kinds — the canonical list, mirroring the `ledger_account_kind`
 * Postgres enum. An integration test asserts this enum and the database's agree, so a kind added in
 * one place cannot silently go unposted in the other.
 */
export const ledgerAccountKindSchema = z.enum([
  "customer",
  "reserved_clearing",
  "revenue",
  "gateway_clearing",
  "writeoff",
  "token_deferred_revenue",
]);
export type LedgerAccountKind = z.infer<typeof ledgerAccountKindSchema>;

/**
 * The seeded chart of accounts (migration 0112). A union rather than a free string so a mistyped code
 * fails to compile instead of posting into an account that does not exist; an integration test pins
 * it against the seeded rows.
 */
export const glAccountCodeSchema = z.enum([
  "1100", // Payment-processor clearing (asset)
  "2100", // Customer wallet liability
  "2110", // Customer funds reserved
  "2200", // Contract liability — prepaid units
  "4100", // Channel revenue
  "5900", // Goodwill and write-offs
]);
export type GlAccountCode = z.infer<typeof glAccountCodeSchema>;

export const glDirectionSchema = z.enum(["debit", "credit"]);
export type GlDirection = z.infer<typeof glDirectionSchema>;

export const glSourceKindSchema = z.enum([
  "ledger_txn",
  "manual_adjustment",
  "reversal",
]);
export type GlSourceKind = z.infer<typeof glSourceKindSchema>;

/** One leg of the subledger movement being mirrored into the company books. */
export const subledgerPostingLegSchema = z
  .object({
    account_kind: ledgerAccountKindSchema,
    direction: glDirectionSchema,
    amount_minor: positiveMinorUnits,
  })
  .strict();
export type SubledgerPostingLeg = z.infer<typeof subledgerPostingLegSchema>;

/**
 * The event the posting airlock carries from a tenant transaction to the general ledger. It describes
 * a subledger movement that already happened — it never asks for one, which is why it names a
 * `ledger_txn_id` that must already exist.
 *
 * `channel` is a reporting dimension and absent for movements that are not channel-specific (a
 * wallet top-up). `tenant_id` is likewise a dimension, not a tenancy claim (ADR-0013 #1).
 */
export const subledgerPostingEventSchema = z
  .object({
    ledger_txn_id: z.string().uuid(),
    currency,
    /** When the movement economically occurred. */
    event_time: z.string().datetime({ offset: true }),
    tenant_id: z.string().uuid(),
    channel: z.string().min(1).max(32).optional(),
    legs: z.array(subledgerPostingLegSchema).min(2),
  })
  .strict();
export type SubledgerPostingEvent = z.infer<typeof subledgerPostingEventSchema>;

export const glJournalLineSpecSchema = z
  .object({
    account_code: glAccountCodeSchema,
    direction: glDirectionSchema,
    amount_minor: positiveMinorUnits,
    tenant_id: z.string().uuid().optional(),
    channel: z.string().min(1).max(32).optional(),
  })
  .strict();
export type GlJournalLineSpec = z.infer<typeof glJournalLineSpecSchema>;

/**
 * A journal ready to post: fully resolved, balanced, and carrying the idempotency key that makes
 * writing it exactly-once. The poster performs no arithmetic of its own — everything it needs was
 * decided by the pure derivation in `@app/domain`.
 */
export const glJournalSpecSchema = z
  .object({
    idempotency_key: z.string().min(1),
    source_kind: glSourceKindSchema,
    source_ref: z.string().min(1),
    currency,
    event_time: z.string().datetime({ offset: true }),
    /** The accounting period, `YYYY-MM-DD`, derived from `event_time` in UTC. */
    accounting_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    memo: z.string().max(500).optional(),
    lines: z.array(glJournalLineSpecSchema).min(2),
  })
  .strict();
export type GlJournalSpec = z.infer<typeof glJournalSpecSchema>;
