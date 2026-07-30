# ADR 0013: Corporate accounting boundary

Status: **proposed 2026-07-30** — engineering foundation accepted for implementation behind no
customer-facing surface. **Finance ratification of the posting matrix and the open policy questions
below is an explicit gate before any live commercial use.**

Implements Phase 1 of
[the money-accounting and commercial-pricing roadmap](../MONEY-ACCOUNTING-AND-COMMERCIAL-PRICING-ROADMAP.md)
(`FIN-001`–`FIN-004`). Builds on [ADR 0010](./0010-pricing-and-billing-model.md) and
[ADR 0012](./0012-channel-agnostic-commercial-offers.md).

## Context

Fabric has one double-entry ledger today (`ledger_accounts` / `ledger_transactions` /
`ledger_entries`). It is a **tenant subledger**: every account, transaction, and entry carries
`tenant_id`, RLS is FORCEd, and each account kind is scoped per `(tenant, currency, kind)`. It
answers the operational question well — *may this send proceed, and what does this customer own?*

It cannot answer the company's questions. There is no account for bank cash, provider expense,
accounts payable, payment-processor fees, tax, or retained earnings; and because every balance is
tenant-scoped behind RLS, there is no consolidated view of what Fabric owns, owes, earns, and spends.
The roadmap's Phase 5–8 work (provider payables, PSP settlement, close, reporting) has nowhere to
post.

Adding company-level accounts to the existing tables is not an option. They are tenant-scoped by
construction: `tenant_id` is `NOT NULL`, RLS is FORCE, and the runtime role cannot bypass it. A
company-level row would need a fake tenant, and consolidated reporting would need to defeat the
isolation that protects customer data.

## Decision

1. **A separate corporate general ledger, tenant-neutral.** New `gl_accounts`, `gl_journals`, and
   `gl_journal_lines` tables. They carry no tenancy and no RLS tenant policy. `tenant_id` appears on
   a journal *line* as a nullable reporting **dimension**, never as a tenancy boundary —
   company-level postings (provider invoices, bank fees) legitimately have no tenant.

   That dimension is deliberately **not a foreign key**, unlike the subledger's `RESTRICT` reference
   to `accounts`. Journal lines are immutable and undeletable by trigger, so no referential action is
   even available to choose: `RESTRICT` would make any tenant that ever appeared in a posting
   permanently undeletable, and `SET NULL`/`CASCADE` require an UPDATE or DELETE the immutability
   trigger refuses. A posted line also records what was true when it posted, and that fact does not
   stop being true because the workspace later closed. Reporting left-joins `accounts` and shows an
   unresolved tenant as such.

2. **The tenant-facing role has no access to the company books.** The migration
   `REVOKE ALL PRIVILEGES ... FROM PUBLIC, app_runtime` and grants only `app_provisioner`. This is
   load-bearing, not defensive: `ALTER DEFAULT PRIVILEGES` grants `app_runtime` DML on every new
   table, so without the revoke a tenant-facing query could read consolidated company revenue. A
   privilege-denial integration test pins it.

3. **The subledger stays the operational source; the GL becomes the financial source.** Neither is
   reconstructed from the other's mutable state. The subledger keeps gating sends and holding
   customer balances. The GL holds the company's books.

4. **One GL control account per subledger account kind, and the mapping is total.** The mapping is an
   exhaustive `Record<LedgerAccountKind, GlAccountCode>`, so a kind added to that union fails to
   compile until it is mapped. Be precise about the limit: `LedgerAccountKind` is a zod enum in
   `@app/contracts`, which is zod-only and browser-safe and so cannot import the schema package —
   meaning a value added to the `ledger_account_kind` *Postgres* enum alone still compiles. The gate
   for that is an integration test (`gl-chart-agreement.integration.spec.ts`) asserting the union, the
   seeded chart of accounts, and the mapping all agree with the database. An unmapped kind would be an
   unreconciled hole in the books.

   | Subledger kind | GL code | GL account | Type |
   | --- | --- | --- | --- |
   | `gateway_clearing` | `1100` | Payment-processor clearing | asset |
   | `customer` | `2100` | Customer wallet liability | liability |
   | `reserved_clearing` | `2110` | Customer funds reserved | liability |
   | `token_deferred_revenue` | `2200` | Contract liability — prepaid units | liability |
   | `revenue` | `4100` | Channel revenue | revenue |
   | `writeoff` | `5900` | Goodwill and write-offs | expense |

5. **Phase 1's GL is a consolidated mirror; later phases make it the real books.** Every posting in
   this phase mirrors a subledger movement through the kind mapping. The GL stops being a mirror in
   Phase 5–6, which add the postings that have no subledger counterpart: provider expense and
   payables, PSP fees, bank settlement, and tax. Stating this plainly avoids the misreading that a
   mirror is the end state.

   | Domain event | Subledger movement | GL journal |
   | --- | --- | --- |
   | Wallet top-up clears | DR `gateway_clearing` / CR `customer` | DR `1100` / CR `2100` |
   | Wallet send reserved | DR `customer` / CR `reserved_clearing` | DR `2100` / CR `2110` |
   | Wallet send delivered | DR `reserved_clearing` / CR `revenue` | DR `2110` / CR `4100` |
   | Wallet send fails | DR `reserved_clearing` / CR `customer` | DR `2110` / CR `2100` |
   | Prepaid purchase clears | DR `gateway_clearing` / CR `token_deferred_revenue` | DR `1100` / CR `2200` |
   | Prepaid unit delivered | DR `token_deferred_revenue` / CR `revenue` | DR `2200` / CR `4100` |

   The table lists the events the wallet and token primitives emit today. It is not the full set the
   mapping permits: because the rule is a generic mirror rather than six hand-written cases, a
   subledger movement touching `writeoff` posts to `5900` without a new rule — which is why `5900` is
   seeded even though no row above names it.

   A reserve posts a real GL reclassification rather than nothing. Total customer liability is
   unchanged by a reserve, so posting nothing would also balance — but then GL `2100` would no
   longer equal the subledger's customer balances while reserves are outstanding, and Finance would
   lose a disclosure it genuinely needs: how much customer money is committed versus available.

6. **Only the accounts this phase posts to are seeded.** Each later phase adds its own accounts in
   its own migration. A chart of accounts full of unposted codes is speculation, and the roadmap
   sequences those postings explicitly.

7. **Balance sign convention is `Σ credits − Σ debits`, uniformly — and no balance is stored.** The
   convention matches the existing subledger, which makes reconciliation a raw numeric comparison with
   no per-account-type sign handling — the class of bug that makes reconciliations quietly wrong.
   Because it makes an asset account compute negative, `gl_accounts.normal_balance`
   (`debit` | `credit`) carries the presentation sign, and reports negate debit-normal accounts for
   display.

   There is deliberately **no cached balance table**. The subledger stores
   `ledger_accounts.balance_minor` because the send path locks that row `FOR UPDATE` to fail closed on
   an overdraw — money in the hot path. The general ledger has no hot path: nothing gates on a company
   balance. A stored projection would therefore buy only a class of drift to detect, plus a privileged
   trigger to maintain a table no application role may write — which would have required the first
   `SECURITY DEFINER` function in a codebase whose security policy pins that count at zero. A balance
   is computed from the append-only lines, and Phase 7 owns reporting performance if a materialized
   rollup is ever needed.

8. **Balanced, complete, single-currency, append-only — enforced by TRIGGER, not by privilege.**
   Currency sits on the journal, so single-currency is structural. A `DEFERRABLE INITIALLY DEFERRED`
   constraint trigger asserts at COMMIT that a journal's lines net to zero **and** that their count
   equals the `line_count` the journal declared; a second one asserts the same from the journal side,
   so a journal cannot commit under-filled or empty.

   `line_count` is what makes a journal a **closed set**, and it is load-bearing rather than
   belt-and-braces. Balance alone leaves a hole: a second balanced pair inserted in a *later*
   transaction also nets to zero, so an append would commit — writing fabricated revenue into an
   already-closed period while every invariant still reported healthy.

   Immutability is enforced by `BEFORE UPDATE OR DELETE` triggers (plus `BEFORE TRUNCATE`, which row
   triggers do not see) that always raise, on both tables, for **every role including the owner**.
   Revoking `UPDATE`/`DELETE` would look sufficient and is not: `prepareRoles()` in
   `src/cloud-migrate.ts` runs *before* `migrate()` on every deploy and unconditionally issues
   `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_provisioner`. This
   migration is journaled, so it runs once; that grant runs forever. Deploy N would leave the correct
   state and deploy N+1 would silently hand the control plane the ability to rewrite posted history,
   with nothing failing. Triggers do not consult grants, so the guarantee survives.

   The privilege boundary in decision 2 *does* depend on grants surviving, so `db:assert` re-checks
   `gl_*` privileges on every deploy — that check is what would have caught the above.

9. **Corrections are reversals, never mutations.** A reversal journal carries
   `reverses_journal_id` and repeats the original's lines with directions flipped and amounts
   unchanged. `reverses_journal_id` is `UNIQUE`, so a journal can be reversed at most once. The
   original is never touched.

10. **Postings cross the tenant boundary through an INSERT-only airlock, not the webhook outbox.**
    A domain write enqueues a `gl_posting_requests` row in the **same transaction** as the subledger
    write. `app_runtime` is granted `INSERT` only — no `SELECT`, `UPDATE`, or `DELETE` — with an RLS
    `WITH CHECK` binding the row to the ambient tenant. A worker running as `app_provisioner` drains
    the queue and posts the journal.

    The tenant path can therefore say *"this happened"* and nothing more: it cannot read the company
    books, cannot alter a posting request, and cannot post a journal. Writing the journal inline
    would require giving `app_runtime` write access to the GL, which decision 2 forbids.

    The existing `outbox_events` table is deliberately **not** reused. It is the *customer webhook*
    outbox, with application and environment containment, and its rows are delivered to customer
    endpoints. Company accounting events must never be deliverable to a tenant endpoint.

11. **Exactly-once by idempotency key, not by delivery guarantee.** A journal's key is
    `{source_kind}:{source_ref}` — for this phase, `ledger_txn:{ledger_transactions.id}`, which is
    globally `UNIQUE` on `gl_journals`. Drain is at-least-once; the key makes the effect
    exactly-once, and it gives the audit a direct answer: every subledger transaction has zero or one
    GL journal. A reversal keys as `reversal:{reversed journal id}` — the same rule, with no
    exception, so a key is always reconstructible from the stored columns and a poster can ask "have I
    already posted this?" rather than discovering it as a constraint violation.

12. **Posting rules are pure functions.** The mapping from a domain event to balanced journal lines
    lives in `@app/domain` with no I/O, over `bigint` only, validated by strict zod contracts at the
    boundary. The posting matrix becomes executable and property-testable rather than prose.

13. **Three timestamps, distinct jobs.** `event_time` (when it happened economically), `posted_at`
    (when we wrote it), and `accounting_date` (which period it belongs to, derived from `event_time`
    in **UTC**). Phase 8's period locks need a date to bite on; storing it now costs nothing and
    avoids restating history later. Finance may later elect a different reporting timezone, which
    would be a forward-only policy change, never a retroactive restatement.

14. **The reconciliation invariant is the phase's exit gate.** For every subledger kind `k` and
    currency `c`, the GL balance of `map(k)` in `c` must equal the sum of that kind's subledger
    balances across all tenants. Both sides derive from append-only records, and the shared sign
    convention (decision 7) makes it a direct comparison. That reconciliation is slice 1c; the GL's own
    invariants — trial balance, and every journal carrying its declared lines — are wired into the
    standing gate now as `db:assert gl`, alongside `checkLedgerInvariants`.

## Open policy questions — Finance gate

These are deliberately unanswered here. Inventing an answer in an engineering ADR would give a
policy decision the appearance of ratification:

- tax-inclusive versus tax-exclusive customer prices, and the tax accounts that follow;
- breakage and forfeiture recognition for unused prepaid units;
- accounting-period length, close ownership, and who may post an adjusting entry;
- the reporting timezone for `accounting_date` if not UTC;
- the named Finance approver for the posting matrix in decision 5.

## Consequences

- Phase 1 lands as three reviewable slices: the GL foundation with nothing posting to it; the
  airlock plus its drain worker wired to the wallet and token primitives; then reconciliation,
  reversal, and the standing invariant.
- The subledger's write paths gain one same-transaction `INSERT` each. No read path changes.
- Postings are per event in this phase. Periodic summarization into the GL is the known scale lever
  if per-message journal volume becomes a problem; the airlock rows stay per-event either way, so
  only the journal grain would change. Deferring it keeps the exit gate provable — "every supported
  wallet event produces balanced, replay-safe postings" is not testable against a summarized ledger.
- The drain worker needs a production caller and a kill-switch, per the repo's rule that a queued job
  which exists only as library code plus a test is not shipped.
- Reporting and close (Phases 7–8) read the GL, not the subledger, and gain the consolidated view
  that RLS previously made impossible.

## Alternatives rejected

- **Add company-level accounts to the existing ledger tables.** They are tenant-scoped with FORCEd
  RLS; a company row would need a sentinel tenant, and consolidation would have to defeat the
  isolation protecting customer data.
- **Derive the company's books from subledger reports on demand.** Reports are reconstructions of
  mutable current state. They cannot carry provider cost, payables, fees, or tax, and they give an
  auditor nothing immutable to trace.
- **Post the GL journal inline in the tenant transaction.** Simpler and atomic, but requires granting
  the tenant-facing role write access to the company books — the boundary this ADR exists to draw.
- **Reuse `outbox_events` as the posting queue.** It is the customer webhook outbox; an accounting
  event landing on a customer endpoint is a disclosure bug, and its application/environment
  containment does not apply to company postings.
- **Make the GL the only ledger and retire the subledger.** The send path needs a tenant-scoped,
  RLS-enforced, fail-closed balance check in the hot path. A consolidated company ledger is the wrong
  shape for that, and money is the one place the roadmap requires failing closed.
- **Store one GL account per currency.** Multiplies the chart of accounts by the currency count and
  makes a new currency a chart-of-accounts migration. Currency belongs on the journal.
- **Mirror the subledger's cached balance table into the GL.** Copies a design whose reason — a
  `FOR UPDATE` overdraw gate in the send path — does not exist here. See decision 7.
- **Enforce append-only by revoking `UPDATE`/`DELETE` alone.** The obvious choice, and wrong here:
  `prepareRoles()` re-grants full DML to `app_provisioner` on every deploy while this migration runs
  once, so the guarantee would hold for exactly one deploy and then lapse silently. Triggers do not
  consult grants. See decision 8.
- **Enforce journal completeness by comparing the parent journal's `posted_at` to the current
  transaction timestamp.** Would reject an append without an extra column, but rests on two
  transactions never sharing a `now()`. "Very unlikely" is not a basis for a money invariant; a
  declared `line_count` is exact.
