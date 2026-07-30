import type {
  GlAccountCode,
  GlJournalLineSpec,
  GlJournalSpec,
  LedgerAccountKind,
  SubledgerPostingEvent,
} from "@app/contracts";

/**
 * POSTING POLICY for the corporate general ledger (ADR-0013). Pure: no I/O, `bigint` arithmetic only,
 * so the posting matrix is executable and property-testable rather than prose in a document.
 */

/**
 * The bridge between the two ledgers (ADR-0013 #4). Each tenant subledger account kind has exactly
 * one consolidated company control account.
 *
 * `Record<LedgerAccountKind, GlAccountCode>` is exhaustive over `LedgerAccountKind`, so a kind added to
 * that union fails to compile until it is mapped here. Be precise about what that does and does not
 * buy: `LedgerAccountKind` is a zod enum in `@app/contracts`, NOT derived from the `ledger_account_kind`
 * Postgres enum — contracts is zod-only and browser-safe and cannot import the schema package. So
 * adding a value to the pgEnum ALONE compiles clean here. What catches that is
 * `gl-chart-agreement.integration.spec.ts`, which asserts the union, the seeded chart of accounts, and
 * this mapping all agree with the database. That gate is an integration test needing a live migrated
 * Postgres, not the compiler.
 *
 * An unmapped kind would be money moving in the subledger with no counterpart in the company's books —
 * a permanent hole in the reconciliation.
 */
export const SUBLEDGER_KIND_TO_GL_ACCOUNT: Readonly<
  Record<LedgerAccountKind, GlAccountCode>
> = {
  gateway_clearing: "1100",
  customer: "2100",
  reserved_clearing: "2110",
  token_deferred_revenue: "2200",
  revenue: "4100",
  writeoff: "5900",
};

/**
 * The accounting period a journal lands in, as `YYYY-MM-DD` in **UTC** (ADR-0013 #13). Deliberately
 * not the local date: the period a movement belongs to must not depend on which region a server ran
 * in, or the same event would close into different periods on different hosts.
 */
export function accountingDateFromEventTime(eventTimeIso: string): string {
  const at = new Date(eventTimeIso);
  if (Number.isNaN(at.getTime())) {
    throw new RangeError(
      `event_time is not a valid timestamp: ${eventTimeIso}`,
    );
  }
  // toISOString is always UTC; the date half is the accounting date.
  return at.toISOString().slice(0, 10);
}

/** `Σ credits − Σ debits` over journal lines, in minor units. Zero for a balanced journal. */
export function netMinor(
  lines: readonly Pick<GlJournalLineSpec, "direction" | "amount_minor">[],
): bigint {
  return lines.reduce(
    (net, line) =>
      line.direction === "credit"
        ? net + BigInt(line.amount_minor)
        : net - BigInt(line.amount_minor),
    0n,
  );
}

/**
 * Reject an unbalanced set of lines before it reaches the database. The write-time trigger would also
 * refuse it, but failing here names the offending journal and keeps a malformed posting out of the
 * airlock's retry loop, where it would otherwise fail forever.
 */
function assertBalanced(
  lines: readonly GlJournalLineSpec[],
  label: string,
): void {
  const net = netMinor(lines);
  if (net !== 0n) {
    throw new RangeError(
      `${label} does not balance: Σ credits − Σ debits = ${net} minor units`,
    );
  }
}

/**
 * Mirror a tenant subledger movement into the company's books.
 *
 * Phase 1's GL is a CONSOLIDATED MIRROR (ADR-0013 #5): each subledger leg becomes one journal line
 * against the mapped control account, keeping direction and amount. Balance therefore carries over
 * from the subledger rather than being recomputed — a mirrored movement is balanced exactly when the
 * movement it mirrors was, which is what makes this correct for every current and future subledger
 * transaction type without a per-type rule to maintain.
 *
 * The idempotency key is `ledger_txn:{id}` (ADR-0013 #11): globally unique, so an at-least-once drain
 * posts exactly once, and every subledger transaction demonstrably has zero or one journal.
 */
export function deriveJournalFromSubledgerEvent(
  event: SubledgerPostingEvent,
): GlJournalSpec {
  const lines: GlJournalLineSpec[] = event.legs.map((leg) => ({
    account_code: SUBLEDGER_KIND_TO_GL_ACCOUNT[leg.account_kind],
    direction: leg.direction,
    amount_minor: leg.amount_minor,
    tenant_id: event.tenant_id,
    ...(event.channel ? { channel: event.channel } : {}),
  }));

  assertBalanced(lines, `journal for ledger_txn ${event.ledger_txn_id}`);

  return {
    idempotency_key: `ledger_txn:${event.ledger_txn_id}`,
    source_kind: "ledger_txn",
    source_ref: event.ledger_txn_id,
    currency: event.currency,
    event_time: event.event_time,
    accounting_date: accountingDateFromEventTime(event.event_time),
    lines,
  };
}

/**
 * Derive the journal that un-posts an earlier one (ADR-0013 #9). Same accounts, same amounts, every
 * direction flipped — so the pair nets to zero and the original stays untouched. Corrections in
 * accounting are new entries, never edits.
 *
 * `originalJournalId` is the posted row's id, which becomes the reversal's `source_ref`, its
 * `reverses_journal_id`, AND the tail of its idempotency key — so the key stays `{source_kind}:{source_ref}`
 * like every other journal's, and a poster can reconstruct it from the stored columns to check "have I
 * already posted this?" instead of discovering it as a constraint violation. That plus the database's
 * UNIQUE on `reverses_journal_id` means a retried correction cannot double-reverse and overstate the
 * books in the opposite direction.
 *
 * NOT USED BY THE POSTING PATH, and deliberately so. `services/api/src/accounting/gl-reversal.ts` is
 * what production calls, and it reads the POSTED lines back instead of re-deriving them: this function
 * would reverse whatever the CURRENT mapping produces, so a mapping change between posting and
 * reversing would credit an account the original never touched — netting to zero, so no invariant would
 * fire, while two control accounts silently went wrong.
 *
 * It survives as the executable statement of what a reversal IS (flip every direction, keep every
 * amount), which its unit tests pin. If the key format ever changes, change it in both places.
 *
 * `eventTimeIso` is the reversal's OWN event time, not the original's: a correction happens when it
 * happens, and back-dating one into a closed period is a decision for the Phase 8 close controls, not
 * a default of this function.
 */
export function deriveReversalJournal(args: {
  readonly original: GlJournalSpec;
  readonly originalJournalId: string;
  readonly eventTimeIso: string;
  readonly memo: string;
}): GlJournalSpec {
  const lines: GlJournalLineSpec[] = args.original.lines.map((line) => ({
    ...line,
    direction: line.direction === "credit" ? "debit" : "credit",
  }));

  assertBalanced(lines, `reversal of journal ${args.originalJournalId}`);

  return {
    idempotency_key: `reversal:${args.originalJournalId}`,
    source_kind: "reversal",
    source_ref: args.originalJournalId,
    currency: args.original.currency,
    event_time: args.eventTimeIso,
    accounting_date: accountingDateFromEventTime(args.eventTimeIso),
    memo: args.memo,
    lines,
  };
}
