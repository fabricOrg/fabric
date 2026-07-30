# Fabric — session handoff

_Snapshot: 2026-07-30. Point-in-time; verify against code/git before asserting as fact. Companion to
[CLAUDE.md](./CLAUDE.md) (the how-we-build guide) and `docs/`._

## START HERE (2026-07-30): money roadmap Phase 1 slice 1a — corporate general ledger

Branch `feature/ops-accounting-boundary` at `232e183`, worktree `D:/work/jojo-worktrees/fin-ledger`,
branched off `dev` at `d80325a`. **Committed, not pushed.** Phase 2 (commercial offers, PR #222) is
already on `dev`; this is Phase 1, which #222 deliberately ran ahead of.

(The branch-name validator only accepts `f<n>` / `e<n>` / `gh-<n>` / `ops` as the scope token — `fin`
is rejected, so roadmap `FIN-*` work uses the `ops` scope, as Phase 2's
`feature/ops-commercial-offers` did.)

Ratified as [ADR-0013](./docs/decisions/0013-corporate-accounting-boundary.md). Phase 1 is sliced into
1a (this: the boundary, nothing posts yet), 1b (the posting airlock + drain worker), 1c
(reconciliation + reversals + the standing gate).

### What 1a establishes

A **tenant-neutral** corporate GL — `gl_accounts`, `gl_journals`, `gl_journal_lines` (0111) plus
write-time enforcement, privileges, and the seeded chart of accounts (0112). Six accounts, one per
subledger account kind, so reconciliation is a 1:1 mapping. `tenant_id` on a journal line is a nullable
reporting **dimension**, not tenancy.

Two separate mechanisms, and the split matters:

- **Who can see the books = privilege.** `REVOKE ALL ... FROM PUBLIC, app_runtime`; only
  `app_provisioner` gets `SELECT, INSERT`. Load-bearing per CLAUDE.md §9 — default privileges would
  otherwise hand `app_runtime` DML on every new table.
- **Whether history can be rewritten = TRIGGER.** `BEFORE UPDATE OR DELETE` (plus `BEFORE TRUNCATE`)
  on both tables, always raising, for every role *including the owner*. See the BLOCKER below for why
  privilege was not enough.

Posting policy is a pure function in `@app/domain` over a `Record<LedgerAccountKind, GlAccountCode>`
that is **exhaustive by type** — a seventh subledger kind will not compile until it is mapped.

### The BLOCKER the independent review found — read this before trusting any REVOKE in this repo

**`prepareRoles()` in `packages/db/src/cloud-migrate.ts:121` re-grants `SELECT, INSERT, UPDATE, DELETE
ON ALL TABLES IN SCHEMA public TO app_provisioner` on EVERY deploy, and it runs BEFORE `migrate()`
(line 203 vs 211).** A migration's `REVOKE` runs once because it is journaled; that grant runs forever.
So deploy N ends in the intended state and **deploy N+1 silently undoes it**, with nothing failing —
`db:assert` runs in the same job and did not look at these tables.

**Scope it precisely** — I checked, and it is narrower than it first looks. `prepareRoles` grants table
privileges to `app_provisioner` ONLY; it never grants to `app_runtime`. So:

| migration | intent for `app_provisioner` | survives a redeploy? |
| --- | --- | --- |
| `0105` sandbox allowances | `SELECT` only | **no** — regains INSERT/UPDATE/DELETE |
| `0112` general ledger | `SELECT, INSERT` | **no** — regains UPDATE/DELETE (now trigger-guarded + asserted) |
| `0096` plugin credentials | full DML | yes (intent is full DML) |
| `0107`, `0110` pricing/offers | full DML | yes |

Every revoke aimed at **`app_runtime`** holds — that is the tenant-isolation boundary and it is not
touched. What lapses is any attempt to keep `app_provisioner` *narrower* than full DML.

**OPEN FOLLOW-UP — `0105` is a live instance, on two counts.** Staff-path code can currently write
`sandbox_usage_buckets` / `sandbox_usage_events` in testing, contrary to what `0105` intends
(`SELECT` only), AND those tables are owned by the local superuser rather than `app_migrator`, so FORCE
RLS does not bite the owner there as it does in prod. Deliberately not fixed in slices 1a/1b to keep
those diffs reviewable. The grant fix is NOT another `REVOKE` migration — that lapses again on the next
deploy for exactly the same reason. It has to be a re-assertion in `checkSecurityLayerApplied` (the same
shape as the `gl_*` and airlock blocks added here) plus adding both tables to `TENANT_TABLES`, so
`db:assert` fails the deploy when either drifts.

Two fixes, and both were needed:

1. **Prevention** — immutability moved off privilege onto triggers, which do not consult grants.
   Verified: with `UPDATE`/`DELETE` re-granted exactly as `prepareRoles` does it, the rewrite is still
   refused (`general ledger history is append-only: UPDATE on gl_journal_lines`).
2. **Detection** — `checkSecurityLayerApplied` now asserts `gl_*` privileges (via
   `has_table_privilege`, so inherited grants count) and the six GL triggers are present. Verified by
   simulating the re-grant: `db:assert` exits 1 naming all six drifted grants; after restoring, exit 0.
   `checkGlInvariants` is now wired into that gate too, as `db:assert gl`.

### The other MAJOR: "balanced" is not enough to close a journal

A journal only ever asserted that its lines net to zero. A **second balanced pair inserted in a later
transaction also nets to zero** — so an append would have committed, writing fabricated revenue into a
closed period while every invariant still reported healthy. Closed by a declared `line_count` on the
journal, asserted from both sides at COMMIT: a journal must carry exactly the lines it said it would,
so it can be neither under-filled nor appended to. That also strengthened the standing invariant, which
now catches a deleted *balanced subset* of lines — the old "has ≥2 lines" check could not.

### Two things the gates caught that are worth remembering

1. **`security-layer.check.ts` pins `ALLOWED_SECURITY_DEFINERS` at empty**, and my first draft needed a
   `SECURITY DEFINER` trigger to maintain a `gl_account_balances` projection that no application role
   could write. That forced the right question: *why* does the subledger store a balance? Because the
   send path locks it `FOR UPDATE` to fail closed on an overdraw. **The GL has no hot path** — nothing
   gates on a company balance. So the projection table was dropped entirely; a balance is
   `Σ credits − Σ debits` over the append-only lines. Fewer tables, no drift class, policy intact.
   The lesson is generic: *copying a shape from the subledger without copying its reason.*
2. **Local `DATABASE_URL_PROVISIONER` connects as `app_owner`, a SUPERUSER** — not as
   `app_provisioner`. A denial test written over that connection **succeeds** and so reports a correct
   migration as broken (it cost a full diagnosis cycle). Privilege assertions must use
   `has_table_privilege('<role>', ...)` on the named role. `DATABASE_URL_APP` is the only URL that
   connects as the role its name implies, so live-connection denial tests are still valid for
   `app_runtime`.

### Other review findings worth carrying forward

- **`tenant_id` on a journal line is no longer a foreign key.** It could not be: lines are undeletable
  by trigger, so `RESTRICT` would make any tenant that ever appeared in a posting permanently
  undeletable — which would have broken the ~30 integration specs that delete their own tenant in
  teardown, the moment slice 1b started posting. `SET NULL`/`CASCADE` need an UPDATE the immutability
  trigger refuses. A dimension is a recorded fact, not a live relationship.
- **The exhaustiveness claim was overstated.** `Record<LedgerAccountKind, GlAccountCode>` is exhaustive
  over the *zod* enum in `@app/contracts`; adding a value to the `ledger_account_kind` **pgEnum** alone
  still compiles, because contracts is browser-safe and cannot import the schema package. The real gate
  is `gl-chart-agreement.integration.spec.ts`, which needs a live migrated Postgres. Comment corrected
  rather than the claim quietly left standing.
- **Slice 1c must reverse the POSTED lines, not a re-derived spec.** `deriveReversalJournal` takes a
  `GlJournalSpec`. If the kind→account mapping changes between posting and reversing, re-deriving would
  credit an account the original never touched — netting to zero, so no invariant fires, while two
  control accounts silently go wrong. Noted in the function.

### Verified, not reported

Migrations applied to local Postgres as the non-super owner, then checked against the database:
6 chart-of-accounts rows all nominated as control accounts, every `ledger_account_kind` mapped, all
6 triggers installed, `app_runtime` holding zero of 7 privileges on every `gl_*` table, and
unbalanced / short / empty / single-line / zero-amount / replayed / appended-to / self-reversed /
double-reversed journals all rejected — plus UPDATE, DELETE and TRUNCATE refused even as owner.
`@app/db` integration: 11 files / 75 tests. `@app/domain`: 22 new unit tests. `db:assert` green, and
proven to go red on a simulated `prepareRoles` re-grant. Guards, biome and typecheck clean.

## Slice 1b (also 2026-07-30): the airlock is live — movements now reach the books

`gl_posting_requests` (0113) + RLS/grants/enqueue trigger (0114), the drain worker
(`services/api/src/accounting/`), a per-minute cron caller, and both ledgers' invariants in the
scheduled pass. **Every wallet and token movement now mirrors into a corporate journal.**

The seam, concretely: `app_runtime` holds `INSERT` and nothing else on the queue — no `SELECT`, so it
is write-only from the tenant side even before RLS — with a `WITH CHECK` binding the row to the ambient
tenant. The drain runs as `app_provisioner`. Verified: runtime is denied SELECT/UPDATE/DELETE (42501)
and a cross-tenant enqueue is refused.

### Three design decisions worth not re-litigating

1. **The enqueue is a deferred TRIGGER on `ledger_transactions`, not a call in each primitive.** A
   primitive that forgot would produce money movement with no counterpart in the books and nothing
   would fail. It must be `DEFERRABLE INITIALLY DEFERRED` because it builds its payload from the legs,
   which do not exist at statement time (`openIdempotentTxn` inserts the envelope, `postLegs` follows).
2. **The request carries its payload, not a pointer.** `provisioner_all` policies exist only on
   `accounts`/`users`/`memberships` — NOT the FORCE-RLS ledger tables. A pointer-only row would have
   required granting the provisioning role cross-tenant read of every customer's money movements.
3. **`ledger_txn_id` is `ON DELETE CASCADE`, not RESTRICT.** In production `ledger_transactions` is
   never deleted, so it never fires there; RESTRICT would have broken the ~30 specs that tear down
   their own ledger rows. The durable audit does not need it — the journal records the same
   `ledger_txn_id` in its own immutable `source_ref`.

### Two defects my own verification caught (neither was visible by reading)

1. **`ON CONFLICT DO NOTHING` needs `SELECT` privilege.** The trigger's insert failed 42501, and the
   "obvious" fix — grant `app_runtime` SELECT — would have destroyed the write-only seam. The clause
   protected against nothing (a constraint trigger fires once per row; `ledger_txn_id` is UNIQUE), so
   it was removed. For money, a loud failure beats a silent skip.
2. **A raw `execute()` returns timestamptz as a STRING, not a `Date`.** `row.event_time.toISOString()`
   threw, the drain classified it transient, and **every** request retried forever while
   `posted: 0, failed: 0` — the error visible only in `last_error`. Fixed by coercing, and the wider
   lesson is now in the code: the drain reports a `retrying` count and the maintenance job logs it at
   error level. A silent retry loop is the same failure mode as a swallowed error, just slower.

### What the independent review changed (all fixed, not deferred)

- **A parked request was a permanent silent hole.** `failed` rows are skipped by the drain's
  `WHERE status = 'pending'` forever, so after the single error log at parking time nothing surfaced
  them and the books quietly understated revenue with every gate green. `checkGlInvariants` now has a
  **third invariant** — no request parked `failed`, none `pending` past 60 minutes — so "every movement
  reaches the books" is an assertion instead of a claim. Gated by a test that parks a request and
  asserts the invariant goes red.
- **A missing chart-of-accounts row was classified permanent.** That is deploy skew, not a bad payload:
  this repo builds one image and promotes it, with migrations as a separate pre-deploy task, so an image
  briefly ahead of its migrations is NORMAL. Parking those would strand every movement of a new account
  kind until someone ran SQL by hand. Now transient, as is an unknown `account_kind` (the pgEnum reaches
  the DB before the widened zod enum reaches the API).
- **My stated reason for carrying the payload was factually wrong.** `0027_provisioner_maintenance_read`
  already gives `app_provisioner` cross-tenant SELECT on `ledger_entries` and `ledger_accounts`, so the
  "a pointer would require granting cross-tenant read" argument was false — in the schema comment, the
  ADR, and this file. The design stands on its real merits (the payload is evidence captured in the
  movement's own transaction; no per-request join into FORCE-RLS tables) and the honest trade-off is now
  stated: a snapshot can go stale.
- **`gl_posting_requests` was absent from the security gate.** Nothing asserted FORCE RLS, a policy, or
  INSERT-only for `app_runtime` — the slice's headline property rested on a one-off manual observation.
  It is now in `TENANT_TABLES` plus an explicit privilege loop (including `TRUNCATE`/`REFERENCES`, and
  `app_provisioner` must not hold DELETE, since deleting a pending request destroys a movement's only
  path to the books).
- **The seam was never exercised adversarially.** Every assertion read through the superuser owner,
  which bypasses RLS — so deleting `REVOKE ALL ... FROM app_runtime` would have left the suite green.
  New `gl-posting-seam.integration.spec.ts` drives runtime denial, cross-tenant rejection, rollback
  safety, and the production caller including its kill path.
- Smaller: `recordFailure` now guards `AND status = 'pending'` (a lost connection at COMMIT could
  otherwise rewrite a `posted` row); `attempts` counts only failures, not successes; the enqueue trigger
  asserts single-currency itself rather than depending on 0007 silently; the balance-sign test asserts
  exact magnitudes on a currency it owns instead of comparing a function to a transcription of its own
  SQL.

### A prod-fidelity gap the gate surfaced — and it is not only mine

`gl_posting_requests` was owned by `app_owner` (the local superuser) because `drizzle-kit migrate`
connects as `DATABASE_URL_OWNER`. FORCE RLS binds the table OWNER, and a superuser bypasses RLS
wholesale — so locally the isolation was weaker than production, where `app_migrator` owns tables and is
deliberately non-superuser. 0114 now pins ownership explicitly (idempotent, a no-op in the cloud).

**`sandbox_usage_buckets` has the same problem** and is not in `TENANT_TABLES`, so nothing reports it.
Same follow-up as its grant drift below.

### Known gap, deliberately left

`gl_journal_lines.channel` is **always NULL today**. `ledger_transactions.metadata` is the idempotency
FINGERPRINT (`{op, currency, amount, ref}`) and no primitive writes a channel. Guessing from the ledger
reason is not acceptable — `message_reserve` is channel-neutral and backs both SMS and email, so a
guess would attribute email revenue to SMS. **Do not fix it by widening the fingerprint**: the
fingerprint is compared on replay, so an extra key turns a retried in-flight movement across a deploy
boundary into an `IdempotencyConflictError`. The channel needs to reach the ledger as its own column.

### Operating it

`GL_POSTING_ENABLED=false` stops the drain without a deploy. Safe to leave off: the enqueue trigger is
unaffected, so nothing is lost — the queue grows and drains when re-enabled. Default is ON, because
withholding posting leaves the books incomplete, which is the worse failure. Requests park as `failed`
after a permanent error or 5 attempts; `last_error` says why.

### Test-isolation lesson for anyone adding GL specs

GL journals are immutable by trigger, so **a spec cannot clean up after itself** — its rows stay, like
production rows. The GL spec therefore uses a run-scoped `X__` currency, but note that 3 characters
carry too little entropy to stay private across *accumulated* runs (journals are never deleted), so
**never assert a fixed absolute balance**. Assert either the run's own journal rows, or the reported
balance against an independently computed aggregate.

## Slice 1c (also 2026-07-30): the exit gate has an assertion behind it

`checkGlReconciliation` (`packages/db/src/gl-reconciliation.ts`) compares, per subledger kind and
currency, the sum of movements that already have a posted journal against the mapped GL control
account. Exposed as `db:assert recon`, and in the hourly invariant pass. Plus `reverseGlJournal` — the
only way to correct posted books.

**Completeness and accuracy are separate invariants, on purpose.** The drain lags by seconds, so a
single combined check would sit permanently amber and stop being read. `checkGlInvariants` invariant 3
asks "has everything reached the books?"; reconciliation asks "for what has, do the totals agree?".
Together they are the exit gate; alone neither is. There is a test asserting that normal drain lag is
NOT reported as a discrepancy.

### Two scope decisions in the reconciliation that need defending

"Exclude rows you find inconvenient" is how reconciliations go quietly wrong, so both exclusions are
argued in the code rather than assumed:

1. **Only the enabled currencies (GHS/NGN/USD).** `gl_journals.currency` is a bare `char(3)` with no
   constraint — the contract's enum is the only narrowing. A journal in another currency is a defect,
   but a *different* one, and absorbing it into a control-account total would hide it.
2. **Only workspaces that still exist.** Journal lines are immutable; subledger movements are not.
   Deleting a tenant requires deleting its ledger rows first (RESTRICT), and the journal lines they
   produced survive by design — leaving a remainder that is un-reconcilable in principle. Holding it
   against every future comparison would leave the gate permanently red, which equals no gate. Near
   unreachable in production (no application role can delete ledger history); routine in tests, where
   every spec tears down its own tenant.

**Every journal kind counts**, though — mirrors, reversals and future manual adjustments alike. A
reversal moves a control account as surely as a mirror does, so excluding it by `source_kind` would let
real divergence hide. That means a reversal DOES show as a discrepancy until a compensating correction
lands, which is correct: the ledgers genuinely disagree in that interval and an accountant should see it.

### The defect the review caught that mattered most

**"No discrepancies" is not "agreement".** `db:assert` connects as `DATABASE_URL_OWNER` — a superuser
locally, but the **non-superuser `app_migrator`** in the cloud. `ledger_entries`, `ledger_accounts` and
`accounts` are all FORCE RLS with permissive policies naming `app_provisioner` only, so in the deployed
configuration the reconciliation would have scanned **zero rows and printed "reconciles"**. The exit-gate
check was vacuous in exactly the environment it exists for, and invisible locally because the local role
is a superuser.

Fixing it took two attempts, and the first was wrong in an instructive way. Comparing "legs scanned"
against a count of `ledger_entries` does nothing — **RLS zeroes the count too**. Nor does comparing
against the visible books side, which false-positives on the orphan residue every test teardown leaves.
The reliable signal is not data at all but **capability**: superuser, or a member of `app_provisioner`.
That is RLS-immune and independent of how much data happens to exist. Gated by a test that runs the check
under `SET ROLE app_migrator` — reproducing the deployed role exactly, since `app_runtime` holds no
privilege on `gl_journals` and errors instead of going quietly blind.

Migration 0115 also pins ownership of the three remaining `gl_*` tables to `app_migrator`, for the same
local-vs-cloud reason 0114 did it for the airlock — ownership decides whether FORCE RLS binds and who a
privilege check exempts, so divergence there means a check can behave differently deployed.

### Also corrected from the review

- The subledger side now joins `gl_journals` on **`(source_kind, source_ref)`**, the structural indexed
  columns, not on a reconstructed `'ledger_txn:' || txn_id`. Nothing constrains the idempotency key to
  equal `{source_kind}:{source_ref}`, so key-matching would let an adjustment keyed `ledger_txn:{uuid}`
  masquerade as a movement's mirror — and the concatenation is not indexable.
- **Every journal kind counts** in the comparison. Excluding reversals or adjustments by `source_kind`
  would let real divergence hide behind a label.
- Reversal: races settle on the DB constraint and return the winner instead of leaking a raw `23505`;
  structured errors with stable codes instead of bare `Error`; refuses a journal whose actual line count
  differs from its declared one (that journal already violates GL invariant 2); records the requesting
  actor in metadata, since a correction needs a who and not just a why.
- Excluded rows are **counted and reported**, not silently dropped — and a mirror journal with no tenant
  is a failure rather than residue.

### A gap this slice exposed and did NOT close

**There is no path to re-post a corrected mirror journal.** A mis-posted journal can be reversed, but
the corrected re-post has no key available — `ledger_txn:{id}` is already taken and globally UNIQUE. So
today the recovery is: reverse (books go to zero for that movement), and the movement then reads as
unposted. Closing this needs a key with a correction component (e.g. `ledger_txn:{id}#2`) and a
deliberate decision about whether reconciliation sums them, which is an ADR-level change rather than
something to slip in. Not urgent — nothing produces a mis-posting today, and both the invariant and the
reconciliation now report one loudly.

### TEST MIGRATIONS FROM AN EMPTY DATABASE BEFORE PUSHING

CI caught a defect on this PR that every local gate passed, and it would have broken **first-time
production provisioning**, not just CI. Postgres refuses to *use* an enum value in the same transaction
that `ALTER TYPE ... ADD VALUE` added it, and drizzle's migrator runs the **entire migration set in one
transaction** — so `gl_accounts.control_for_kind`, typed as `ledger_account_kind`, could not be seeded
with `token_deferred_revenue` on a database migrated from scratch. An incrementally-migrated local
database committed that `ADD VALUE` long ago, so the seed was legal and `pnpm db:migrate` was green.

**`drizzle-kit migrate` reports the failure as literally `undefined`.** To see the real error, apply
through the library:

```js
import { migrate } from 'drizzle-orm/postgres-js/migrator';
try { await migrate(drizzle(sql), { migrationsFolder: 'packages/db/migrations' }); }
catch (e) { console.log(e.message, e.cause?.message); }
```

So: `CREATE DATABASE` a scratch one and run the full journal against it before pushing any migration.
Roles are cluster-level and already exist. A green `db:migrate` against your working database proves
nothing about the path CI and fresh provisioning take. This is the second time in one session that
"works on my incrementally-migrated DB" hid a real defect — the first was table ownership.

A fix-up migration cannot repair this class of problem, since the seed and the `ADD VALUE` share a
transaction; the offending migration and its snapshots have to be edited in place, verified with
`db:assert:drift`.

### Test-suite note

`services/api/src/payments/auto-topup-concurrency.integration.spec.ts` is **flaky under full-suite
load** — it asserts a mocked `fetch` was called once and intermittently sees zero. Observed twice in one
session; passes 3/3 in isolation both times, with no code change. Do not chase it as a regression from
accounting work; it touches auto top-up and Paystack mocking only.

### Next — Phase 1 is done; Phase 2 is the offer work already on `dev`

Phase 1's exit gate is met. What remains from its original scope, neither blocking:

- **Channel attribution** on journal lines. `gl_journal_lines.channel` is always NULL because no ledger
  movement carries a channel, and it must NOT be added via the idempotency fingerprint (the fingerprint
  is compared on replay, so an extra key turns an in-flight retry across a deploy into an
  `IdempotencyConflictError`). It needs to reach the ledger as its own column. A reporting dimension,
  not a correctness gap.
- **The corrected-re-post key gap** described above.
- The two pre-existing `0105` issues (grant drift + table ownership).

Then Phase 3 — purchase and exact entitlement accounting — which is where the Phase 2 offer schema and
this accounting foundation finally meet.

Two reminders that stay true: do **not** reuse `outbox_events` for accounting (it is the customer
webhook outbox, and an accounting event on a tenant endpoint is a disclosure bug), and do **not** trust
a migration's `REVOKE` to survive a deploy.

### Local DB housekeeping done along the way

Three orphaned test rows from 2026-07-13 (`email_dispatches`, `email_messages`, `inbound_messages`)
were blocking tenant-cleanup hooks in three isolation specs — pre-existing, reproduced on untouched
`dev`, unrelated to this change. Deleted; that suite is green again.

## NEW BUG (2026-07-28): customer-dashboard member invite sends no email

**Staff invites now WORK on the admin console** — user-confirmed after setting the per-app WorkOS
keys. That **settles the open question**: WorkOS invitations ARE application-scoped (belong to the
app whose API key created them). The inference behind #205 was right, and it is now evidence rather
than a hypothesis. Anywhere the docs still hedge on that, they can be tightened.

**But a customer-dashboard member invite produced no email.** Not yet diagnosed.

### Why there is no evidence to look at

`services/api/src/members/members-invite.ts:68` discards the failure completely:

```ts
await getWorkos().userManagement.sendInvitation({ email }).catch(() => undefined);
```

No log, no error, no audit. The staff path was given a log line in #205; this one has nothing — so
"no email arrived" produces zero signal anywhere. **Fix the observability FIRST** (mirror the staff
service: log the failure, and log the accept-URL ORIGIN on success — never the full URL, it carries
the invitation token). Diagnosing before that is guesswork.

### Candidate causes, cheapest first

1. **Expected, not a bug.** WorkOS rejects `sendInvitation` for an email that already has a user or
   a pending invite — the comment above the call says exactly that, and the person is meant to just
   sign in and bind. If the invitee already has a WorkOS identity, no email is correct behaviour.
   The membership row is still written, so access works.
2. **The API's `WORKOS_API_KEY` was changed to the ADMIN app's key.** Member invites are CUSTOMER
   realm and must go out under the customer dashboard's key. If the API's key was repointed while
   configuring per-app keys, customer invites now originate from the wrong application. Check which
   application the API's `WORKOS_API_KEY` belongs to — `WORKOS_ADMIN_API_KEY` is the separate one
   the staff client uses (#205).
3. WorkOS-side delivery (spam, suppression, sender domain) — check the WorkOS dashboard's invitation
   list: if the invitation EXISTS there, the API call succeeded and it is a delivery problem, not a
   code one. That single check splits 1/2 from 3.

### Note on the swallow itself

`.catch(() => undefined)` is defensible for not blocking the membership write — the local row is the
source of truth for access. It is NOT defensible to discard the reason. Same failure mode as the
integration assertions that threw away the response body (#194): the system behaved "correctly" and
told nobody why.

## START HERE (2026-07-28, late): ADR-0011 slices 1–4 DEPLOYED to testing; slice 5 still open

**Deployed 2026-07-28** — PR #211 (5 commits) + PR #212 (the migration fix) squash-merged to `dev`,
`dev` merged to `testing`, run `30405278317` green: migrations → Vercel (www / dashboard /
admin-console) → Render api live. `testing` = `41f8576`.

Verified against the hosted database, not the workflow's own report:

| check | result |
| --- | --- |
| migration rows | 101 (97 → +4, i.e. 0097–0100 applied) |
| `MYBRAND` (the pre-existing active sender) | `active` / `approved` / `carrier_ref='grandfathered:0097'` |
| `SWEEP818` | `pending` / `unregistered` — correctly untouched |
| `plugin_instances.credentials_ref` | `text` → `uuid` |
| `uniq_plugin_instance` | `UNIQUE NULLS NOT DISTINCT (tenant_id, capability, vendor, mode)` |
| `payments` | `provider_mode`, `plugin_instance_id`, `credential_version` present |
| `senders` FORCE RLS | `true` — restored; the 0097 lift did not leak |
| api `/health` | `{"status":"ok","db":"up"}` |

### The deploy failure worth remembering: FORCE RLS silently voids a migration backfill

The first attempt (run `30404624322`) died on `23514` — the check constraint "violated by some row"
that the `UPDATE` directly above it had supposedly just fixed.

`senders` carries `FORCE ROW LEVEL SECURITY` (0036), and **FORCE subjects the table OWNER to the
tenant policy too** — the owner being exactly the role `cloud-migrate` runs `migrate()` as
(`packages/db/src/cloud-migrate.ts:211`). A migration sets no `app.tenant_id`, so the backfill matched
ZERO rows, while `ADD CONSTRAINT` validated the table *regardless of RLS* and found the untouched row.

**No local gate could have caught it**: the test harness migrates as a SUPERUSER, which bypasses RLS
even under FORCE. Another entry in the §9 "a green local gate is not CI" column.

The fix (0097) lifts FORCE around the backfill only, then restores it. **Any future migration that
backfills a FORCE-RLS tenant table has this same trap** — a silently-zero `UPDATE` that only surfaces
if something downstream validates the whole table. Most won't have a constraint to catch them.

Editing 0097 in place was safe because drizzle's migrator skips by TIMESTAMP
(`created_at < folderMillis`, `pg-core/dialect.js:62`), not by content hash — verified in
`node_modules`, not assumed.

### What still blocks the first live send

`PLUGIN_MASTER_KEY` must be present on the Render service. It is declared in `render.yaml`
(`sync: false`) but that file does NOT retro-apply to an already-provisioned service. Nothing has
exercised it yet — every `credentials_ref` is still null — so its presence is unproven from this side.
If it is missing, `derivePluginMasterKey` THROWS under `NODE_ENV=production` (deliberately: it must
never fall back to the development key), and installing the Arkesel credential 500s with
`PLUGIN_MASTER_KEY must be set to at least 32 characters in production`. That error is the signal.

Set it once and never rotate it casually: a credential sealed under one master key cannot be opened
under another, and the failure surfaces at DISPATCH, not at save.

## Earlier (2026-07-28): plugin architecture — ADR-0011, slices 1+2a done, 2b/3/4/5 open

**The mandate: external providers are control-plane PLUGINS, not environment variables.** Adding,
swapping, or taking a provider live must be a staff action, never a redeploy. Read
[ADR-0011](./docs/decisions/0011-provider-plugins-as-control-plane-config.md) first — it has the full
design and the five slices.

### What is DONE (merged, deployed to testing)

- **Slice 1 — credential store.** `plugin_credentials` (migrations 0095 + 0096). Per-credential DEK
  wrapped under a platform master key; the secret sealed under that DEK, never under the master key
  directly, so revoking one provider destroys one wrapped DEK rather than re-encrypting everything.
  AAD binds instance AND version — rotation keeps the old row, so without version binding a
  superseded key would still decrypt against the record that replaced it. 12 crypto tests.
- **Slice 2a — registry + resolver.** `smsAdapterFor(vendor)` in `@app/integrations` maps a vendor
  string to an adapter (the fake provider is deliberately ABSENT — it must be unreachable by
  resolving a vendor name). `PluginResolverService` walks the enabled chain primary-first, caches
  30s, serves last-known-good on a blip, and **fails closed** with nothing cached. 9 tests.

`PLUGIN_MASTER_KEY` is set on Render (done 2026-07-28).

### What is NOT done — and the order matters

**Slice 2b — wire `deps()` to the resolver. THIS IS THE BLOCKER.** Until it lands, `SMS_PROVIDER` /
`ARKESEL_API_KEY` still drive routing and the whole plugin story is inert.

**2b part 1 DONE (2026-07-28): settlement now keys on the DISPATCHING provider.** Found while
scoping — a naive "make `deps()` async" would have shipped a money bug. `deps.provider` is read on
RESOLUTION paths, not just dispatch: `resolveMessage` takes `billableStatuses` +
`platformFaultExemptions` from it to decide commit-vs-refund, and `ingestDlr` matches on
`provider_slug`. Once staff can swap a vendor between a send and its DLR/sweep, that adapter is the
WRONG one — `arkesel-sms` bills at `accepted`, `virtual-phone` at `undelivered`, and
`billableStatuses[0]` is exactly the `STATUS_RANK` threshold `reachedBillable` compares against.

Fix: `resolveMessage` reads each row's own `provider_slug` (stamped at `prepare-send.ts:84`) and
resolves the adapter through a new `smsResolutionAdapterFor(slug)` in `@app/integrations`. That map
is slug-keyed and DOES include `fake-sms` + `virtual-phone`, unlike the vendor-keyed dispatch
registry which deliberately excludes the fake — the two answer different questions ("who carries
this new send?" vs "whose rules govern one already sent?"), and both files say so at length.

**Bonus: this DISSOLVED the hard part of 2b.** `sweepExpired`'s `depsForMode` factory existed only
to hand it the right provider per message, keyed off `delivery_mode` as a proxy. With slug-based
resolution it is dead code — deleted, along with the `(mode) => this.deps(mode)` call site. The
cross-package async-factory contract change the earlier plan feared is simply gone.

**Verified by removing the fix and re-running** (the null hypothesis, §9): it does NOT silently lose
revenue. The wrong rules attempt a refund on an already-committed message, the B6 commit-XOR-refund
constraint catches it, and `sweepExpired` throws `AlreadyResolvedError` from inside its row loop —
so one such message aborts that tenant's ENTIRE sweep and strands every reservation behind it. The
ledger invariant protects the money; nothing protected the sweeper. Gates: integrations 48/48,
sms-engine integration 13/13 (incl. a new regression test), api + sms-engine typecheck 0, biome clean.

**THE LIVE-RECIPIENT PIN IS GONE (2026-07-28) — do not re-introduce it.** User directive: *"lets
remove the restriction and the pin, we can send to any number"*, with the product goal that
**customers register a sender ID, staff approve it, and they then send to their own audiences without
hindrance.** A platform-wide recipient allowlist is incompatible with a multi-tenant product, so the
whole rail was deleted rather than re-pointed.

Removed: `SMS_LIVE_RECIPIENT_ALLOWLIST` + parsing, `isLiveRecipientAllowed`, the `E164` const, the
entire `sms-live-safety.ts` module, the call site in `sms.service.ts`, the allowlist clause in
`liveProviderReadiness`, the `live_recipient_not_allowed` code and the dashboard branch that rendered
it, and the `.env.example` / `ecs.tf` / `database.tf` references. Live readiness now turns on
credentials + carrier mode only. Gates: integrations 48/48, api unit 198/198, api + dashboard
typecheck 0, biome clean.

Worth knowing: this rail had ALSO been about to break silently. It only engaged when
`SMS_PROVIDER === 'arkesel'`, a var the plugin path retires — so on a deployed stack it would have
read `fake` and allowed every recipient while the resolver dispatched to real Arkesel. Whatever
replaces a guard must key on **resolved provider identity**, never on `SMS_PROVIDER`. The same trap
applies to anything else still reading that var before slice 5.

What still governs who may be messaged, all per-tenant and already built: sender-ID registration,
consent/opt-out suppression, promotional quiet hours (`assertSendCompliant`), the wallet failing
closed on funds, both kill-switches, and sandbox environments hard-pinned to the virtual phone.

### Sender approval now models the CARRIER side (2026-07-28, migration 0097)

The product goal is *"customers register a sender ID, we approve, they send without hindrance."* The
blocker was never the pin — it was that `decide('active')` never talked to the carrier. Arkesel
exposes **no sender-ID registration endpoint**, so `active` was a claim nothing backed: the network
then rejects with `PROHIBITED` (`arkesel/provider.ts:50` → `failed`), the reservation refunds, and
the customer sees an "active" sender that cannot deliver.

- `senders` gains `carrier_status` (`unregistered|submitted|approved|rejected`) + `carrier_ref` +
  `carrier_decided_at`, and a CHECK `sender_active_requires_carrier_approval`. A **constraint**, not
  a service guard — a migration, fixture, or future code path can bypass service logic, and the
  database simply refuses to hold the lie.
- **Admin-only.** The carrier fields live on `adminSenderDtoSchema` only, never `senderDtoSchema`,
  so a customer response cannot carry them. Customers still see `pending → active/rejected`.
- `decide()` refuses `active` unless `carrier_status = 'approved'` (`carrier_not_approved`); new
  audited `setCarrierStatus()` + `POST /internal/admin/senders/:id/carrier-status`.
- **The backfill was load-bearing**: `ADD CONSTRAINT` validates existing rows, and 1 already-active
  sender (the local live pilot) would have failed the migration. Grandfathered as
  `carrier_ref = 'grandfathered:0097'` so the assumption stays auditable — anything carrying that
  marker should be re-confirmed against the carrier.
- Verified on real Postgres: the constraint REFUSES `active`+`unregistered`, ALLOWS
  `active`+`approved`. senders integration 3/3 proves register → pending → refused → record carrier
  → activate → send 201. api unit 198/198; api + admin-console typecheck 0.

**Still open on this thread:** the admin-console surface for carrier state (disable Activate until
carrier-approved rather than letting staff hit the error), and the customer-side "send a test
message" confirmation that their ID actually works — which must reuse the REAL send path (normal
wallet reserve/commit, normal gates), because a bypassed test proves nothing about real sends.

**2b part 2 REMAINS — `deps()` async + resolver-derived provider identity.** 12 call sites, not the
9 previously recorded. The three that were missed are all env-derived provider identity:
`sms.service.ts:95` (`liveReady` gate), `sms.service.ts:104` and `sms-dispatch-recheck.ts:47` (both
`provider.slug` for the `provider.<slug>` kill-switch). The rest are simple `await`s;
`sms-dispatch-recheck.ts:53` is already inside an async closure, so only its interface at `:17`
changes. Note the resolver speaks `'sandbox' | 'live'` while the engine speaks `DeliveryMode
'virtual' | 'live'` — map deliberately, do not conflate. `deps()` still binds provider + creds at
construction (`sms-runtime.service.ts:52`).

**Slice 3 — DONE (2026-07-28, migration 0098).** `unique(tenant_id, capability, vendor, mode)`
**NULLS NOT DISTINCT** + nullable `tenant_id` FK to accounts (RESTRICT). The modifier is
load-bearing: Postgres treats NULLs as distinct, so a plain UNIQUE over a nullable `tenant_id` would
have allowed unlimited duplicate PLATFORM-WIDE rows — the exact collision the constraint exists to
stop, silently permitted for the most common row shape. Also closed a latent defect the new column
made expressible: the resolver did not filter `tenant_id`, so the first tenant-scoped instance would
have started carrying everyone's traffic. And the catalog seeder's `onConflictDoNothing` target must
match the constraint exactly or Postgres cannot infer an arbiter index (42P10).

**Slice 4 — API DONE (2026-07-28, migration 0099 + `PluginCredentialsService`); maker-checker
deferred.** `configure()` did not exist at all — slice 1 landed the credential STORE and the crypto,
but nothing ever wrote to it, so `PLUGIN_MASTER_KEY` being set on Render still left no way to install
a key. Now: validates against the adapter's own `configSchema`, seals through the envelope, INSERTs
at the next version (rotation is recoverable), repoints `credentials_ref`, audits **fingerprint and
version only**. New `activate-live` action refuses without installed credentials. `createLiveInstance`
makes live its own row rather than flipping the sandbox row's mode, which would repoint sandbox
traffic at a carrier.

**§6 earned status is real now**: `apply('enable')` no longer claims `connected` — that was a guess
presented to staff as fact. `markDispatchOutcome()` is the only writer and is called from the actual
dispatch path (a method with no caller is not shipped). Note Arkesel's `healthCheck()` is a stub that
returns `up` unconditionally and the contract passes it no credentials, so deriving status from it
would just relocate the same lie; ADR §6's other permitted source — the outcome of the last dispatch —
is what we use.

Migration 0099 also fixes `credentials_ref` `text` → `uuid` + FK ON DELETE SET NULL: text vs uuid has
no equality operator so the fingerprint join failed outright, and a pruned credential now degrades to
an honest "not configured" instead of a dangling id. Needs an explicit `USING` — text→uuid has no
assignment cast.

**Maker-checker (§5) is deliberately NOT built.** `proposals.decide()` enforces separation of duties,
so gating `activate-live` behind it makes activation impossible for a SINGLE staff operator — it
would block the very journey this work enables. Activation is still audited and still refuses without
validated credentials. Revisit when a second operator exists.

**Admin console surfaces — DONE.** `configure-plugin-dialog.tsx` was a MOCK (a `setTimeout(400)` that
toasted "configured", stored nothing, and claimed "Stored encrypted in Vault"). It now writes for
real. Plugins page gained mode + fingerprint, "Add live", "Rotate key", and **Activate live disabled
with the reason** until credentials exist. Sender review gained the carrier line plus "Mark
submitted" / "Carrier approved", with **Activate disabled until carrier-approved**.

### Payments moved into the plugin system too (2026-07-28)

User directive: *"the plugin system must be consistent"* — sandbox customers charge with test keys,
live customers with live keys, same `activate-live` gate as Arkesel.

**The answer to "does the Paystack live key work in the plugin" was NO, and it looked like it did.**
Payments read `PAYSTACK_SECRET_KEY` from env (`payments.service.ts`, `auto-topup.service.ts`); the
resolver hardcoded `capability: 'sms'`; and `configure()` skipped schema validation for non-SMS, so a
Paystack key pasted into the admin form stored under `apiKey` when the adapter requires `secretKey` —
green toast, real fingerprint, unusable credential.

Now: `resolve(capability, mode)` with `resolveSms` / `resolvePayment` sharing one cache and one
fail-closed posture; a payment vendor→adapter registry; `adapterConfigSchemaFor()` so `configure()`
validates EVERY capability; both payment services resolve through
`payment-provider-resolution.ts`. Mode comes from the account's **plan** (sandbox → test keys, else
live) because a top-up funds the workspace, not one application environment — a send routes on its
environment instead, which is why the two differ.

**Webhook multi-key verification.** A Paystack webhook carries no tenant and must be verified BEFORE
its body is trusted, so we cannot read the reference to pick a key without trusting unverified input.
It tries each configured key until one HMAC matches — constant work over keys we own, and forging
still needs a valid HMAC under one of them.

**Two test lessons worth keeping.** `flows.integration.spec.ts` swapped a private `provider` FIELD on
PaymentsService; that field is gone, so the swap silently stopped working and the spec made a REAL
Paystack call ("Invalid key"). It now stubs the resolver — the seam the code actually uses. And
`plugin_instances` is GLOBAL config with no tenant scoping, so any spec leaving an instance ENABLED
changes resolution for every other spec; both plugin tests now disable inside the test rather than in
`afterAll`.

Gates: full api integration **58 files / 272 tests**, integrations 48/48, all typechecks + biome clean.

### Independent review (codex, 2026-07-28) — 12 findings fixed, 1 rejected

Ran `codex exec -s read-only` over `origin/dev...HEAD`. Every finding was verified against the code
before acting; the ones that landed:

- **Credential/mode consistency** was the worst. A LIVE Arkesel instance whose credential omits
  `sandbox='false'` is accepted by Arkesel, never forwarded to a carrier, returns `accepted` — and
  `billableStatuses[0]` COMMITS the wallet reservation. Fabricated success, billed. Now
  `credentialModeViolation()` rejects it at configure time, and the Paystack equivalent binds key
  prefixes (`sk_live_` ⇄ live, `sk_test_` ⇄ sandbox) so a sandbox workspace cannot make real charges.
- **Webhook mode binding.** The verified candidate's mode was discarded, so a webhook signed with the
  TEST key could settle a LIVE reference and credit a real wallet. `payments` now records
  `provider_mode` / `plugin_instance_id` / `credential_version` (migration 0100) and the webhook
  refuses a mismatch. Test keys circulate far more loosely — that is what made it worth closing.
- **Rotation stranded in-flight webhooks.** Verification now considers each enabled instance's
  current AND previous credential version, bounded at two.
- **`invalidate()` had ZERO production callers.** A rotated or disabled provider stayed live for up
  to the 30s TTL. Now called from `configure()` and every registry mutation. (Caveat: clears the
  local process only; other replicas still age out on their own TTL.)
- **Dispatch-time provider identity.** `provider_slug` was stamped at PREPARE, but on the queued path
  a worker dispatches later — long enough for selection to change — so settlement could key on a
  provider that did not send. `dispatchSend` now re-stamps with who actually sent, and its own rules
  govern that transition. Near-zero window on hosted today (no Redis → inline dispatch), real once
  the worker returns.
- `make-default` demoted by capability alone, resetting live priorities when a sandbox instance was
  promoted — now scoped to `(tenant, capability, mode)`.
- `PLUGIN_MASTER_KEY` was missing from `ecs.tf`; without it the API cannot install OR resolve any
  credential on the AWS path. Secret + injection added.
- Paystack's `secretKey` rendered as PLAIN TEXT in the admin form (only `apiKey` was masked). Masking
  now comes from field metadata, defaulting to masked for unknown vendors.

**Rejected:** "removing the recipient allowlist exceeds the redline" — that was an explicit user
decision, which codex had no way to know. Worth noting it reached the concern independently.

**Two test lessons.** `flows.integration.spec.ts` stubbed a private `provider` FIELD that no longer
exists, so the stub silently became a no-op and the spec made a REAL Paystack call. It now stubs the
resolver. And `plugin_instances` is global config — a spec leaving an instance enabled changes
resolution for every other spec.

Gates after fixes: full api integration **58 files / 272 tests**, integrations **53/53**, api unit
198/198, all four typechecks + biome clean.

### Pre-merge preflight against the HOSTED database (2026-07-28) — migrations are safe

Read-only check of Neon before merging PR #211, run because the review correctly flagged that one
migration rested on an *assumption* about production data rather than a check.

| check | result |
|-------|--------|
| schema version | **97 migration rows** (through `0096`), latest 2026-07-27 |
| `plugin_instances.credentials_ref` | type `text`, **8 rows, 0 non-null** → **`0099` text→uuid is SAFE** |
| `senders.carrier_status` | absent — `0097` has not run |
| `0097` backfill scope | **exactly one sender**: `MYBRAND (GH)` on tenant `00000000…` (the seed tenant) |
| `senders` size | **2 rows** — the `NOT VALID` + batched-backfill suggestion is unnecessary at this scale |

**The `0099` assumption is now VERIFIED, not assumed.** That was the single unchecked claim in the
batch and it holds: nothing has ever written `credentials_ref`, because `configure()` did not exist
until this branch.

**Know what `0097` grandfathers.** `MYBRAND` is already `active`, so the backfill preserves the
status quo rather than granting anything — demoting it would break a working seed. But it gets
stamped `grandfathered:0097`, which by design means *we assumed, we did not verify*. If MYBRAND was
never registered with Arkesel, that row now claims otherwise. It is NOT `AKWAAH` — the pilot sender
exists only in the local database, so the dogfood run registers it fresh through the real flow.

**Credential note for the next session:** `.env.migrate.local`'s `app_migrator` password is STALE —
CI's `ALTER ROLE` rotated it to the GitHub secret value, exactly as this file already warned. Use
`DATABASE_URL_ADMIN` from that file for read-only hosted checks; the other roles there still work.

### The journey is now buildable end to end — what remains is doing it

Audited against code, not comments: request go-live (dashboard card → proposal) ✅ · staff approve
**executes** (flips `accounts.plan`, unlocks locked live envs, audited, double-approve safe) ✅ ·
mint `sk_live_` ✅ · register sender ✅ · admin records carrier + activates ✅ · fund wallet via
`POST /v1/payments/topup` ✅ · send ✅.

Two things to know before the run:
- **Paystack live keys are redlined off**, so funding the live wallet uses a sandbox test card — no
  real money IN, while the Arkesel send is real money OUT of our master account. Fine for a first
  send; do not read the wallet balance as a real payment.
- `proposals.service.ts:84-87` still claims execution is *"deferred (target features don't exist
  yet)"*. **Stale — it contradicts line 229 of its own function.** Nearly caused a false report.

**Slice 5 — seed from env, then DELETE the env path.** Two sources of truth for provider selection
is how this drifted originally.

### Facts a fresh context will need

- **Live SMS works.** First real message sent 2026-07-27 via Arkesel: sender `AKWAAH` (the approved
  one — NOT "Fabric"), to +233545227189, 1 segment, GHS 0.03, committed against the double-entry
  wallet. `scripts/dev/seed-live-sms.ts` + `pnpm dev:seed:live-sms` provision the local pilot tenant.
- **A sandbox worker can swallow a live send.** `/v1/sms/send` only reserves and enqueues; the
  WORKER calls the provider. Any API process on the same Redis competes for jobs, and FakeProvider
  returns `accepted` identically. **Verify `provider_ref`, never `status`** — `fake-<messageId>` vs a
  real UUID. This cost a false "the SMS went out" claim.
- **DLRs need a public callback.** Local runs are `dlr=off`, so status stops at `accepted` and never
  reaches `delivered`. Hosted can do better — `ARKESEL_DLR_CALLBACK_URL` + `WEBHOOK_INGRESS_TOKEN`.
- **The plugin registry was decorative.** The admin console renders it; nothing in the send path
  imported it. That is the bug ADR-0011 exists to fix.
- **`app_runtime` nearly got read access to the credential vault.** `ALTER DEFAULT PRIVILEGES` grants
  the runtime role DML on every table the migrator creates, so `plugin_credentials` arrived with
  `SELECT` already granted. Migration 0096's REVOKE is load-bearing. **Unverified on Neon** — confirm
  with `SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name =
  'plugin_credentials'` (expect only `app_migrator` + `app_provisioner`).

### Also open

- **#7 integration flakes.** One FIXED with measurement (#195: audit spec walked the global
  `audit_events` table, 201 rows → 101 pages vs a 100-page guard — deterministic at that size). TWO
  STILL OPEN and NOT reproduced in four local runs: consent's transactional 400, managed-messages'
  concurrent 500. #194 instrumented both to print the cause. **Do not paper over the 500** — it may
  be a real idempotency defect.
- **Two dependabot PRs are RED and need migrations, not merges.** #203 TypeScript 5.9→7.0 (exposes
  that `packages/fe-auth` uses `node:crypto`/`Buffer` without declaring `@types/node`; the build
  halted at the first package so there may be more). #200 react-day-picker 9→10 (breaking
  `ClassNames` API at `packages/ui/src/components/ui/calendar.tsx:90`). The other six bumps merged.
- **WorkOS per-app keys.** #205 added a staff-realm client on `WORKOS_ADMIN_API_KEY`, inert until
  configured. The first real staff invite logs the accept-URL ORIGIN — that settles whether
  invitations are application-scoped (inferred, NOT documented). If it logs the dashboard origin, the
  inference was wrong and #188's callback routing is what protects operators.

## Earlier (2026-07-27, later): seven PRs — #188–#195 — merged and deployed to testing

Bug-fix session driven by live screenshots. `dev` and `testing` both carry #188–#195.

**The pattern worth carrying forward: three of the four reported bugs were SHARED PRIMITIVES with an
assumption baked in, not the one-page problems the screenshots suggested.** Each fix was 3–5× the
scope of the report. Expect this rather than rediscovering it.

| PR | fix | reported as |
|----|-----|-------------|
| #188 | staff invitees routed to the admin console | "invited to admin, landed in dashboard" |
| #189 | CORS on `/v1/public/*` | "CORS error" on the landing page |
| #190 | `useCursorPage` re-seeds on fresh server props | "removed user, table didn't invalidate" |
| #191 | primary-application resolver replaces `slug='default'` in **5** places | "virtual reply won't record" |
| #192 | price-book currency constrained to the settleable enum | "typing the currency will bring unpredictables" |
| #193 | price-book editor → own page; rates as a matrix | "this can be its own page" / "card could be better" |
| #194 | flaky integration assertions now capture the response | (found while working) |
| #195 | audit pagination spec stops walking the global log | (found while working) |

### ✅ RESOLVED (2026-07-28): the CORS allowlist reached Render

`PUBLIC_CORS_ALLOWED_ORIGINS` was set in the **Render dashboard** (`fabric-api` → Environment).
Verified live, headers not report:

```
$ curl -sI -H "Origin: https://www-kohl-kappa.vercel.app" \
    https://fabric-jezz.onrender.com/v1/public/pricing
HTTP/1.1 200 OK
access-control-allow-origin: https://www-kohl-kappa.vercel.app
vary: Origin
```

The body carries 6 real rates (sms+email × GHS/NGN/USD, `effective_at` 2026-07-27), so a
subscription book is now flagged `is_public` as well and the landing calculator has data.

**The reusable lesson, since it will recur:** a var added to `render.yaml` does NOT reach an
already-provisioned service. `deploy-testing.yml` triggers Render via `RENDER_API_SERVICE_ID` (a
deploy hook), which never re-reads the blueprint — `render.yaml` only applies on a blueprint sync.
Any new Render env var must be set in the dashboard (or via a blueprint sync) as a separate human
step. The failure was silent because the allowlist correctly fails closed on an empty parse, so a
missing var and a wrong var look identical from outside.

### Integration-test flakiness — 1 of 3 fixed WITH EVIDENCE, 2 still open

Failed 2 of 3 PRs on diffs that could not touch them (once on a PR changing only a React hook).

- **FIXED (#195), proven not guessed.** `audit.integration.spec.ts` walked the ENTIRE global
  `audit_events` table 2 rows/page with a 100-page guard. That table is global, every parallel spec
  appends, most never clean up. Measured at the moment of failure: **201 rows → 101 pages vs a
  100-page guard**, so it fails DETERMINISTICALLY at that size — it only looked flaky because the
  threshold is crossed gradually as rows accumulate. Now stops once its 5 tagged rows are collected.
- **STILL OPEN.** `consent.integration.spec.ts` (transactional send → 400) and
  `managed-messages.integration.spec.ts` (500 under 3 concurrent identical sends). **Did NOT
  reproduce across 4 local suite runs.** #194 instrumented both to capture the response body/error
  code, so the next occurrence names its own cause. Leading hypothesis for consent:
  `sms_sending_paused` from the GLOBAL kill-switch another spec toggles — unconfirmed, do not act
  on it without evidence. The managed-messages 500 may be a REAL production defect in the
  idempotency path; do not paper it over with a randomised fixture.
- **Related hygiene:** `audit_events` grows unbounded across runs (specs clean tenant rows, not
  audit rows). Same shape as the bug; will keep producing failures.

### Local dev environment facts (learned the hard way)

- **Docker Desktop needs an ELEVATED start** — `com.docker.service` is Manual/Stopped and a
  non-elevated agent cannot start it. Orphaned `com.docker.backend` processes block startup and
  must be killed first. Symptom: `docker ps` hangs, port 5432 answers but auth fails.
- **`.env`'s DB passwords are stale.** Real ones come from Infisical (`infisical run --env=dev`),
  which points at **localhost** (safe to run the integration suite against — NOT Neon).
- **`@app/contracts` is consumed as built `dist`.** Changing a contract type and running
  `pnpm --filter @app/api typecheck` validates against STALE `.d.ts` and passes falsely. Always
  `pnpm --filter @app/contracts build` first. Cost a CI round-trip.
- **`packages/ui` is consumed as RAW TS SOURCE** (`"./hooks/*": "./src/hooks/*.ts"`). NodeNext wants
  a `.js` extension on relative imports; the apps' bundler then can't resolve it. Keep shared hooks
  in ONE file — this broke the admin-console build.
- **The file-length guard counts one MORE line than `wc -l`.**
- **Never pipe a git/gate command whose exit code matters** — `cmd | tail` returns tail's status.
  This silently reported a green gate on a failed push AND a successful promotion that was a no-op.
  Verify deploys by inspecting the ref, not the command's report.
- **Don't edit files while a push runs** — `verify:push` gates the WORKING TREE, so a half-finished
  edit fails a push of unrelated commits.
- Stale `.next` from a build on another branch fails typecheck after a branch switch.

## Earlier (2026-07-27): ADR-0010 COMPLETE + deployed to testing; the deploy pipeline had never migrated

`dev` carries #172–#185. **All four surfaces deployed green on testing, api included**, and the
testing database is finally at migration **0094**.

### What shipped

- **ADR-0010 complete end to end.** Phase 1 price books (#172) and the whole Phase 2 token vertical:
  count layer + grant (#175), hold/commit/return (#176), tokens-first send path (#177), revenue
  recognition (#178), purchase + admin token books (#179). Money stays in the ONE ledger — purchase
  credits `token_deferred_revenue` (a liability), consumption discharges it into `revenue` at the
  lot's **locked** price. Count tables carry no money column, so a count-layer bug cannot mint cash.
- **www landing repositioning + public rate card (#180).** Headline now leads with the outcome
  ("Turn product events into customer messages"). Page 15,328px → 7,748px, 16 → 13 sections. The
  pricing section gained a **working cost calculator**; it previously said "live rates in the
  dashboard", i.e. sign up to learn the price. Also killed a FALSE claim ("email billed by rendered
  size") that Phase 1 had already retired.
- **`GET /v1/public/pricing`** — unauthenticated by design. Guarding it with `BFF_INTERNAL_TOKEN`
  would put a key that can call `/internal/*` on the marketing site, and www is a static build with
  nowhere to keep one. Safety is the response SHAPE: no book identity, no tenant, no negotiated
  rates. Staff flag ONE subscription book `is_public` (DB CHECK forbids a token book being it).
  Display **fails open** to compiled fallbacks — a stale price beats an error while someone budgets.
- **Two live-use bug fixes (#174)**: webhook table offered "Disable" on already-disabled endpoints;
  virtual-phone reply failures reported "data could not be loaded" because bare `throw new Error`s
  escaped as opaque 500s.

### THE BIG ONE: testing had never been migrated

`deploy-testing.yml` had **no migration step**. The AWS pre-deploy task used to do it; nothing
replaced it when testing moved to Neon + Render + Vercel. Verified read-only: **0 of 6** pricing/token
tables existed and `accounts.price_book_id` was absent — every migration from **0087** was missing
while the api that queries them deployed happily. That, not any UI bug, is why admin **Pricing** and
**Tenants** were erroring.

Fixed by a `migrate-testing` job that `deploy-api-render` **depends on**, so the api can never again
start against a schema it lacks (it correctly stayed `skipped` through five failed attempts). It
**fails loudly** on missing secrets rather than skipping — a quiet skip is what hid this.

**Six Neon-vs-RDS differences surfaced, one per deploy** (`cloud-migrate` was written for RDS):

| # | Failure | Fix |
|---|---|---|
| 1 | `@app/domain` unresolvable | `prebuild` in www (#181) |
| 2 | `TypeError: Invalid URL` | `??` misses empty-string env (#182) |
| 3 | `permission denied to alter role` | tolerate **only** `42501` (#183) |
| 4 | `app_migrator failed least-privilege` | **`neon roles create` grants `neon_superuser`** — delete it, let migrate create it |
| 5 | `permission denied for schema drizzle` | hand the bookkeeping schema over (#184) |
| 6 | `must be owner of table` | `REASSIGN OWNED` — schema owner ≠ table owner (#185) |

**Lesson worth keeping: local state masked CI reality every time** (prebuilt `dist`, populated env
vars, a Postgres allowing `ALTER ROLE`). Reproduce cold before believing a fix. The loop only broke
when we ran `cloud:migrate` **locally against Neon** and surfaced the rest in one pass.

### Neon facts (project `dry-recipe-09519949`, branch `production`, db `neondb`)

- **Single branch — testing and production share it.**
- Roles: `neondb_owner` (admin, `createRole`), `app_migrator` (created BY migrate, least-privileged),
  `app_runtime` + `app_provisioner` (`rolbypassrls = false` — tenant RLS depends on this).
- **Never point `DATABASE_URL_APP` at `neondb_owner`**: it has `bypassRls`, which silently disables
  tenant isolation. The four URLs cannot be collapsed.
- **Do NOT create `app_migrator` via the Neon CLI** — Neon grants it `neon_superuser` and the
  least-privilege assertion rejects it.
- Connection strings contain `&`; **quote them** in env files or the shell truncates at the ampersand.

### Deployed state

api `fabric-jezz.onrender.com` ✅ · www / dashboard / admin-console on Vercel ✅ · schema at 0094 ✅
(verified independently: 6/6 tables, `accounts.price_book_id`, `price_books.is_public`,
`messages.backing`, 6 RLS policies).

### The staff-invite bug — FIXED (2026-07-27, local, unpushed)

A stakeholder invited to the **admin console** landed in the **customer dashboard** and got an
account. **Two claims in the previous entry were wrong — don't repeat them:**

- ✗ "add an admin-console destination to `sendInvitation`". `SendInvitationOptions` (@workos-inc/node
  10.8.0) is `{ email, organizationId?, expiresInDays?, inviterUserId?, roleSlug?, locale? }` —
  **there is no redirect/destination field.** Nothing configurable in WorkOS fixes this.
- ✗ "the invitee is silently created as a CUSTOMER tenant". `UserSessionService.resolve` creates only
  a bare `users` row with **zero memberships**. The tenant appears only if the person then completes
  the onboarding form, which `createWorkspace` obliges (no allowlist check there — still true).

**Verified against the live WorkOS account (read-only MCP).** Staging holds THREE AuthKit
applications, not one: Customer Dashboard (`client_01KWP2NBN6…`, **isDefault**, and the only app
with an API key), Admin Console (`client_01KX21AVNE…`, **zero keys**), Developer Portal
(`client_01KX225M73…`, zero keys). WorkOS API keys are scoped **per application**, so the console
borrows the dashboard's pair — which is why `fabric-admin-console.vercel.app/auth/callback` and
`localhost:3300/auth/callback` are registered on the **dashboard** application's redirect list. The
customer app will hand an OAuth code to the staff origin. Invitations are issued by the DEFAULT
application, so a staff invite always lands on the dashboard callback.

**Fix — routing, in our callback.** resolve-v2 reports `staff_realm` (allowlist match, ROUTING ONLY,
never an authz signal; `z.boolean().default(false)` so a dashboard deployed ahead of the API keeps
today's behaviour). Both dashboard landing paths — OAuth callback and the ADR-0008 credential path —
send a staff identity with **zero memberships** to the admin console, mint no dashboard session, and
clear any session left by a previous identity (a survivor skipped the `/signin` fallback, since that
page redirects an already-signed-in visitor to `/`, and dropped the operator into someone else's
workspace). The WorkOS session is deliberately NOT ended — the console's OAuth hop needs it. Staff
who also hold a membership fall through and use the dashboard normally.

Touched: `packages/contracts/src/identity.ts`, `services/api/src/identity/user-session.service.ts`,
`packages/fe-auth/src/types.ts`, `apps/dashboard/{app/auth/callback/route.ts,
lib/server/{auth,identity-client,credential-landing}.ts, app/signin/page.tsx}`, `.env.example`,
`infra/dev/dashboard.tf`. New: `ADMIN_CONSOLE_BASE_URL` on the dashboard (returns null rather than
guessing in prod → in-app `staff_account` notice). Also made the admin override a PAIR —
`WORKOS_ADMIN_CLIENT_ID` + `WORKOS_ADMIN_API_KEY` only take effect together, because a client id
without its matching key IS the mis-pairing that breaks the code exchange.

Gates: `pnpm typecheck` exit 0; dashboard 79 tests, contracts 71 — both green (5 + 2 new).
Codex read-only review: one Medium (the stale-cookie hole above) fixed, one Low (coverage) closed.

**Still open, needs a human — ordered so nothing breaks:** ① mint an API key for the Fabric Admin
Console app (`app_01KX21AVNEXG01Q9S1AFD81Q1N`) — a credential creation, so not an agent action;
② set both admin env vars on the console only; ③ verify staff sign-in; ④ THEN remove
`redir_01KXTFRZZMM7W51ARE49TMJ11E` + `redir_01KXTFRZZNKGMZCZ8YM8MS0SDJ` from the dashboard app.
Doing ④ first locks every operator out. None of this replaces the routing fix — invitations carry no
application, so staff invites keep landing on the dashboard regardless.

Also unset: `ADMIN_CONSOLE_BASE_URL` on the dashboard's **Vercel** project
(`https://fabric-admin-console.vercel.app`) — not in the repo, so it must be set there.

### Live SMS pilot — ON HOLD (scaffolding local + unpushed, nothing sent)

Held 2026-07-27: the sender ID has to clear Arkesel first (see the carrier-approval gap below), so
the scaffolding below stays in the working tree and is deliberately NOT part of the auth-fix PR.

`scripts/dev/seed-live-sms.ts` + `pnpm dev:seed:live-sms` provision a LOCAL live-capable tenant
(plan `growth`, active live environment, `sk_live_` key, sender approved locally, GHS 200 credited).
Needed because the normal dev seed is plan `sandbox`, and a sandbox ENVIRONMENT is hard-pinned to
the virtual phone (ADR-0004) — it can never reach a carrier. `.env.live-sms` holds the run config
(gitignored via `.env.*`).

~~The existing rails already implement the live-pinning directive.~~ **Obsolete — the recipient pin
was removed 2026-07-28** (see the ADR-0011 section above). Live sends go to any number; per-tenant
sender registration + consent govern reach.

Blocked on three human steps: `infisical login` (session expired — the seed's DB auth failed because
`.env`'s DB passwords are stale and the real ones are in Infisical), an Arkesel-approved sender ID
(`Fabric`; carrier approval is not instant), and the Arkesel key pasted into `.env.live-sms`.

**Carrier-approval gap found while scoping this.** Arkesel exposes **no sender-ID registration
endpoint** (v2 is send / DLR / OTP / contacts / balance; registration is a dashboard action plus
network-level operator registration), and `SmsSenderPlugin` has no registration method either. So
our `senders` table is a purely LOCAL record: an operator can mark a sender `active` in Fabric while
Arkesel has never approved it — `assertSendCompliant` passes, Arkesel then rejects with `PROHIBITED`
→ mapped `failed` → reservation refunded. Money is safe; the dashboard lies. Worth deciding whether
the admin console should distinguish *Fabric-approved* from *carrier-approved*, because today one
implies the other and that isn't true.

Launch, once unblocked — note the `env` prefix goes AFTER `infisical run`, because Infisical's
values override the parent env and Node's `--env-file` cannot override an already-set var (verified):

```
infisical run --env=dev -- env SMS_PROVIDER=arkesel ARKESEL_SANDBOX=false \
  ARKESEL_API_KEY=… pnpm dev:api
```

### Money/pricing: what is actually LEFT

ADR-0010's SMS path is complete and verified. The rest is not:

- **Email cannot spend tokens.** Hold/settle lives only in the sms engine's `prepareSend`; the email
  accept path still `reserve()`s from the wallet. The purchase endpoint accepted BOTH channels, so an
  email token took real money for an entitlement nothing could consume — lot unusable, liability
  never discharging, customer paying twice. **Fenced off in #187** (refuses `token_channel_unavailable`
  before writing an intent). **Wiring email properly is still to do**: a hold in
  `email-managed-accept.ts`, settle on the email dispatch resolve path, and the sweeper branch.
  Worth noting how it hid: contract modelled both channels, everything typechecked, every test
  passed — nothing asserted that a PURCHASABLE channel must also be SPENDABLE.
- **Unverified**: whether any email token lots already exist on testing. Almost certainly zero (no
  token book configured) — but it is a money question, so check. Note `/v1/public/pricing` now
  returns 200 with 6 rates, so the "it still 404s" half of that reasoning is retired; the
  SUBSCRIPTION book is public, which says nothing about token books.
- **Phase 3** dashboard: buy-tokens flow, token balance, plan surface. API exists, no UI.
- **Phase 4** spend-based auto price-book upgrade (loyalty). **Phase 5** SES adapter.
- **Breakage recognition** — `token_breakage` enum exists with NO caller. With no expiry, deferred
  revenue for never-sent tokens sits indefinitely. Finance decision (review §6.5).
- **Review §6.2 consumption order** — FIFO, resolved by ASSUMPTION not sign-off. Only visible once a
  tenant holds lots bought at different prices.

### Also open

- **One staff action left** (intentionally off — seeding a rate would be the fabricated pricing
  ADR-0010 §11 forbids): create a token-mode book so `POST /v1/tokens/purchase` stops returning
  `token_price_unavailable`. ~~flag a subscription book `is_public`~~ — DONE, confirmed by
  `/v1/public/pricing` serving 6 rates on 2026-07-28.
- **Set `PUBLIC_API_URL` + `PUBLIC_DASHBOARD_URL`** in the www Vercel project. Both are baked at
  build time and fall back to **testing** hosts, so a production deploy that omits them silently
  points pricing and every CTA at testing.
- **Stale AWS "Deploy" workflow** still fails every push with `Could not assume role with OIDC`.
  Pre-existing; decide whether to delete or repoint it.
- **Admin console is off-standard**: pages render bare `<p>` errors while `packages/ui` ships
  `ErrorState`/`EmptyState`.
- **`.env.migrate.local`** (gitignored) holds local migration URLs incl. an `app_migrator` password
  generated locally; CI's `ALTER ROLE` should have reset it to the GitHub secret value.
- Landing-page brief only part-delivered: card reduction, more product surfaces, keynote pacing and
  the "remove anything generic" sweep are untouched.

## Earlier (2026-07-26): token slice 2a MERGED (#175) + two live-use bug fixes (#174)

`dev` at `9943446`. Phase 2 is under way; the review (#173) was signed off on §2 (one-ledger) and
§6.3 (counter granularity).

- **Slice 2a MERGED (#175)** — count layer + idempotent grant. `token_purchases` (intent,
  platform-level like `payments`; CHECK ties `amount_minor = quantity × locked price`),
  `token_lots` (append-only, price-locked, `UNIQUE(tenant_id, purchase_reference)` = grant-once),
  `token_counters` (spendable projection per **(tenant, channel, currency)**, `CHECK available >= 0`).
  Migrations **0088** (tables + ledger enum adds) + **0089** (FORCE RLS + policies + grants; the
  purchase intent is provisioner-only). New ledger vocabulary: account kind `token_deferred_revenue`,
  reasons `token_purchase|token_consume|token_breakage`, txn type `token_purchase`.
  **Money stays in the ONE ledger**: purchase = `debit gateway_clearing / credit token_deferred_revenue`
  (a liability — we owe N sends); revenue is recognized only on consumption (2c). Count tables carry
  no money column, so a count-layer bug cannot mint or lose cash. `grantTokensForPurchase` reads the
  stored intent ITSELF (a forged webhook cannot inflate a grant) and raises the counter only when the
  lot row was genuinely inserted (replay = no-op). **Feature invisible — no purchase endpoint until
  tokens are spendable (2b).** 8 real-Postgres tests + 47 existing money specs green (shipped
  reserve→commit/refund provably unchanged) + `db:assert:drift`.
- **Bug fixes MERGED (#174)**, both found from live use:
  - webhooks table rendered **Disable on an already-disabled endpoint** (re-ran the mutation,
    re-marking pending deliveries dead). Guarded on `status === "active"`, matching api-keys-table.
    No "Enable" — the api has create/disable/replay only, so it would be a dead control.
  - a failed **virtual-phone reply** reported "Virtual phone data could not be loaded." Three
    defects: `recordVirtualReply` threw **bare Errors** across the boundary (→ Nest's generic 500),
    the BFF forwarded that unstructured payload verbatim, and the page used one load-shaped fallback
    for every action. Now structured codes (`sandbox_environment_missing`,
    `virtual_reply_not_recorded`), a guaranteed `{error:{message}}` envelope, per-action fallbacks.
    **NOT reproduced on the reporter's env** (deployed testing stack); the local DB has no virtual
    messages. `sandbox_environment_missing` is the likely cause — the query needs an app slugged
    `default` with a sandbox env, and accounts without one exist locally.
- **Review §6.2 (cross-lot consumption order) resolved by ASSUMPTION, not sign-off** — a hold draws
  from lots **expiry-soonest, then oldest (FIFO)**, so that is the locked price recognized. Rationale:
  no expiry exists yet (ADR #7), which makes the expiry clause inert and the policy identical to plain
  FIFO today; FIFO is the standard for releasing deferred revenue; and it is a one-line `ORDER BY` to
  change. It only becomes visible once a tenant holds lots bought at DIFFERENT prices. **Flag to the
  product owner if a different recognition order is wanted.**
- **Note for 2b**: SMS is priced **per segment**, so a hold quantity is the segment count, NOT 1.
  Email is 1 per send.

## Earlier (2026-07-25, later): Phase 1 MERGED to `dev` (#172) + Phase 2 token review drafted

Phase 1 price books **squash-merged to `dev`** as `87d0ff7` (PR #172, `verify` CI green 4m53s) — the
`feature/ops-pricing-rate-books` branch is deleted. Pre-merge tech-debt/quality sweep: **clean** — no
`any`/mock/TODO/dead control; money-correct (preview cost == send cost per account); BFF secured
(`staff:write` + trusted origin, actor from session, contracts parsed both sides); fail-open resolver
+ fail-closed wallet. (codex capped till 07-28, gemini dead — reviewed the money path myself.)

**Phase 2 (tokens) gate started, NOT built.** The ADR requires a wallet+security review before token
code. Drafted `docs/decisions/0010-token-subsystem-wallet-security-review.md` (**DRAFT, needs human
sign-off**). Core recommendation: **do NOT build parallel double-entry in count space** — keep money
in the one ledger (purchase = `debit gateway_clearing / credit token_deferred_revenue`; consumption =
`debit token_deferred_revenue / credit revenue` at the lot's locked price; new `ledger_account_kind`
`token_deferred_revenue` + `token_*` reasons). A separate count layer (lots/holds, FOR UPDATE counter,
B6-style commit-XOR-return backstop, idempotent Paystack-grant) tracks entitlement only and
structurally can't move cash. Six open questions flagged (mostly finance/product; **only counter
granularity (§6.3) blocks schema**). **No token code until §2/§6 are signed off.**

## Latest (2026-07-25): ADR-0010 pricing build — Phase 1 slices 1+2+3 (MERGED #172; was `feature/ops-pricing-rate-books`)

Replaced the hardcoded rate constants with **staff-configurable price books** resolved per account,
flattened email pricing to **flat per send**, and shipped the admin-console pricing config + per-account
assignment. Phase 1 complete (slices 1–3); Phase 2 (tokens) still gated on a wallet/security review.
**Zero price change on launch** — the seeded default book == old rates.

- **Slice 3 — admin config + assignment.** `PriceBookAdminService` (list/create/update/assign, audited;
  clears the resolver cache on a price edit, invalidates the account on assign) behind
  `PricingController` (`/internal/admin/price-books`, BffToken-guarded) + transactional `price-book-writes.ts`.
  Admin-console `/pricing` page (Operations nav) — book cards + a create/edit dialog with a dynamic
  per-channel/currency rate table; the tenant detail page gains a Pricing card + book-assignment picker.
  BFF routes gate `staff:write` + trusted origin. `tenant_summary` DTO gains `price_book_id`. Mode is
  fixed to `subscription` in the UI (token books do nothing until Phase 2 — no dead control ships).
  5 real-Postgres admin tests (create/list, assign→resolver reprice, one-default-per-mode, the DB `> 0`
  floor, unknown id/account).

- **Slice 1 — data model + resolution.** New control-plane tables `price_books` + `price_book_rates`
  (no RLS, like `kill_switches`; default privileges cover provisioner grants) + nullable
  `accounts.price_book_id` FK (`ON DELETE SET NULL`). Migration **`0087_slippery_morgan_stark`**
  (tables + FKs + `mode`/`channel` CHECKs + `unit_price_minor > 0` CHECK + partial-unique
  `uniq_default_price_book_per_mode`). `PricingService.resolveRates(accountId)`
  (`services/api/src/pricing/`) mirrors `KillSwitchService`: 30s TTL cache (bounded prune), **fails
  OPEN to last-known-good → compiled default** on a store read failure; the wallet reserve still
  **fails CLOSED** downstream. Per-channel guard: an empty book falls to compiled default, never
  reprices to zero; an unpriced currency still rejects (`UnknownCurrencyError`). Seeds the default
  "Subscription — Standard" book (existence-gated) at boot. Contracts in `@app/contracts/price-books`
  (read + upsert/assign DTOs, ready for slice 3). 5 real-Postgres tests.
- **Slice 2 — wiring + email flatten.** Resolved SMS rates injected into `EngineDeps.rates` at the
  `prepareSend` choke point (`sms-runtime.service.ts deps(mode, rates?)` ← `sms.service.ts`); the
  preview service prices SMS+email against the book (preview cost == send cost per account — email
  parity is structural: managed accept reuses the preview `costMinor`). **Email flattened**:
  `rateEmailBySize`→`rateEmailFlat` in `@app/domain/rating`, `EmailPreview.tier` dropped across
  domain/contracts/SDK/dashboard/docs, 256 KiB ceiling kept as a blocker, dead
  `EmailPayloadTooLargeError` removed.
- **Gates**: all packages typecheck; domain 90 / SDK 56 / API-unit 167 / **API integration 214**;
  biome clean; migration proven-applies. **Independent review** (Opus subagent — codex hit its usage
  cap until 2026-07-28, gemini dead): _approve with changes_, no critical/tenancy defect; 3 findings
  dispositioned — **DB `> 0` price CHECK added**, cache bounded, seed existence-gated + comment fixed.
- **Next**: Phase 2 tokens (count-based per-channel entitlements, Paystack-backed purchase, tokens-first
  send-path consumption) — gated on a wallet/security review per the ADR; then Phase 4 spend-based
  loyalty auto-upgrade + Phase 5 SES adapter. **Redlines hold** — nothing pushed; `dev` advances only by
  squash-merge on a human go.

## Latest (2026-07-24, late): testing deploy live + publish pipeline + ADR 0010 ratified

Big integration+deploy night. `dev` is the DEFAULT branch now (flipped from `main`, which was 126
commits stale and blocked workflow dispatch). All the feature/ops-www-scaffold work is on `dev`.

- **Merged to `dev`** (#161) then found/fixed a `dev`-red: the sms-pagination integration test
  re-derived Postgres sort order in JS (fragile) — rewrote it to compare the paged walk to a single
  unpaged query from the same DB (#164). Dependabot #155/#162/#163 merged.
- **`dev`→`testing` promoted; ALL FOUR surfaces deployed green** via `deploy-testing.yml`: API on
  **Render**, dashboard/admin/www on **Vercel** (git-integration, gated by `testing` env var
  `VERCEL_RENDER_TESTING_ENABLED`). Fixes needed on the way + **back-ported to `dev`** (#165) so
  `dev`≡`testing`: (a) biome lint debt in divergent files; (b) `deploy-testing.yml` missing pnpm
  setup before `vercel build` (`sh: pnpm: not found`) — added setup-node+corepack; (c) added
  `apps/www/vercel.json` (framework astro). **Gotcha**: the www Vercel project's **Root Directory
  must be `apps/www`** (dashboard setting, not repo) or Astro's `dist` isn't found — user set it.
- **MIT** on SDK+CLI (#95af820). **ADR 0010 ratified** (#166) — **unused tokens NON-refundable**.
- **npm publish pipeline (`publish.yml`) fixed + PROVEN** (#167 added `pnpm build:shared` before
  release:check). It now builds, passes checks, and **signs provenance** — but the final upload is
  **blocked on npm account config**: `@fabric-messaging/sdk` exists (maintainer `dacostaaboagye`,
  published beta.1–3; beta.4/5/6 never actually published) and npm rejects the OIDC publish with a
  masked **E404 = trusted-publisher not authorizing**. **ACTION (user, npmjs.com):** on the
  `@fabric-messaging/sdk` (and `/cli`) package → Trusted Publishers → add repo `fabricOrg/fabric` +
  workflow `publish.yml` + environment `testing`. Publish job requires `--ref testing` (the `testing`
  env restricts deploy branches). Then re-dispatch `publish.yml`.
- **Pricing build (ADR 0010) not started** — deferred to a fresh focused session. Phase 1 =
  rate-card + price-books (contracts → DB → API resolution replacing hardcoded `DEFAULT_RATES` →
  admin-console config), flatten email to per-send. Phase 2 (tokens) gated on a wallet/security
  review per the ADR. Pricing branch `feature/ops-pricing-model` exists (rebase on `dev` first).

## Earlier (2026-07-24, night): MIT licensing + pricing ADR 0010 (proposed)

- **SDK + CLI now MIT** (`95af820`) — resolves the publish blocker (was UNLICENSED + public
  publishConfig). Copyright "Fabric", 2026. Server/dashboard/API stay proprietary. **Publish still
  needs human go.**
- **Pricing model designed → `docs/decisions/0010-pricing-and-billing-model.md` (proposed).** Shaped
  with the product owner over a long session; grounded in a full wallet/rating recon + web research
  on email/SMS pricing. Decisions locked: two modes — **subscription** (existing money wallet, PAYG,
  auto-topup) + **tokens** (count-based per-channel counters, NO wallet, one-off, price-locked,
  procured on demand — no physical pool since Arkesel supply is elastic); **price books** (named
  rate plans per account, admin-console configurable, control-plane read-through cache, fail-open
  except money); **tokens priced above subscription** for lock-in + spend-based auto price-book
  upgrade; SMS per-segment, **email flat per-send** (retire the un-cost-justified 1/3/6 size tier),
  voice roadmap-only; **no token expiry**; send path = price-book → tokens-first → wallet → reject.
  **Email ESP = Amazon SES** (margin-first, eu-west-1, own deliverability; behind the existing
  `FakeEmailProvider`; live human-gated). Email attachments deferred (keep 256 KiB cap).
- **NOT yet done / open**: ADR needs product-owner **ratification** + a wallet/security review
  before any build; **unused-token refund policy** undecided (drives revenue recognition). No code
  until ratified. Phased build sequence is in the ADR Follow-up.

## Earlier (2026-07-24, evening): SDK 1.0-path batch — casing, pagination, beta.6 (committed, not pushed)

Three more commits on the same branch:

- **`14a20bf` refactor(sms)** — BREAKING: SMS read wire fields normalized to snake_case
  (`created_at`, `delivery_mode`, `sender_id`, `failure_reason`, `request_id`) across contracts →
  API serializer (`sms-read.ts`) → SDK parsers → dashboard (messages-table, overview route). SDK TS
  surface stays camelCase. openapi regenerated.
- **`a0a8331` feat(api)** — cursor pagination (keyset `created_at DESC, id DESC`, opaque base64url
  cursor, limit 1..100 default 50, limit+1 detection) on GET /v1/messages, /v1/email/messages,
  /v1/webhooks/:id/deliveries. New `services/api/src/http/cursor.ts` (codec + parsePageQuery,
  fails closed `invalid_cursor`/`invalid_page`); contracts `pagination.ts` + required nullable
  `next_cursor` on the 3 envelopes. SDK: `list({limit,cursor})` → `{items,nextCursor}` page +
  `sms.iterate`/`email.iterate`/`webhooks.iterateDeliveries` generators. Splits for file-length
  guard: `sdk/src/webhook-parsers.ts`, `api/src/webhooks/webhook-delivery-reads.ts`. www docs
  snippets updated (sms, email index, retries-idempotency, node table).
- **`76efda6` chore(sdk)** — SDK+CLI both bumped **0.1.0-beta.6** (CLI adopts SDK version each
  release; CLI CHANGELOG added). New `pnpm playground:refresh` packs SDK into
  `examples/sdk-playground/vendor/fabric-messaging-sdk.tgz` (STABLE name; old versioned tgz
  deleted; playground dep updated). ESM-only decision recorded (Node≥22 require(esm); no CJS).

**Reviewed + hardened** (commits `<hotfix>` after the batch): independent reviewer flagged a real
keyset bug — the cursor round-tripped `created_at` through a JS `Date` (ms) while timestamptz is µs,
skipping sub-ms rows and breaking the same-transaction id tiebreak (a 100-msg batch shares one
`now()`). Fixed in two steps: (a) carry the cursor as µs-precise `to_char` TEXT; (b) **compare via
`::text::timestamptz`, NOT a bare `::timestamptz`** — verified against real Postgres that the
postgres.js driver binds the ISO string so a direct `::timestamptz` cast RE-TRUNCATES to ms (a SQL
literal keeps µs; a bound param does not). New `sms-pagination.integration.spec.ts` walks a page
boundary landing inside a 3-row µs-identical batch and asserts every row once — fails with a bare
cast. Commits: `1b66e88` (final cast fix + integration guard) on top of the earlier partial fix.

**Driver gotcha to remember**: with postgres.js/drizzle, `${isoString}::timestamptz` truncates to
millisecond; use `${isoString}::text::timestamptz` when µs matters.

**Gates run**: SDK `release:check` green; CLI `release:check` green; API tsc + 167 unit +
sms-pagination integration green; dashboard + contracts tsc clean. **NOT yet done**: full
`verify:push`; push/PR (needs human go). Earlier batches (www + SDK audit fixes) also independently
reviewed.

**Still parked for human decisions**: SDK+CLI license (UNLICENSED vs public publish — blocker),
public domain (site/sitemap/canonical/absolute og:image), www deploy to Vercel, legal pages,
pricing numbers. Remaining engineering ticket: contracts→OpenAPI generator (openapi-definitions.mjs
still hand-maintained).

## Earlier (2026-07-24, later): www polish + SDK audit fixes (committed, not pushed)

Same branch, five commits on top of `9c61e91`: `2c6563d` (HANDOFF), `ae2cc4b` (consistency/honesty/
spacing/motion polish incl. removing a fabricated 99.2% stat), `ed62029` (duotone animated capability
icons + **catch-and-release Lifecycle rewrite** + OG card `public/og.png` + branded 404 + docs-header
mark + preconnects), `b482ecc` (SDK: `InsufficientFundsError` 402, webhooks `remove`/`disable` =
soft-delete documented, README/CHANGELOG accuracy, lint in `release:check`, 5 new spec files — 55/55).

- **Lifecycle now "catch & release"**: per-stage rows; card pins (`position: sticky`) near viewport
  centre, description scrolls up the centre thread, and because card+copy share the same fixed
  `--lc-band` at the row's end the sticky range ends exactly when they align — the pair exits
  together. Verified in headless Chromium (local playwright + `chromium-1208` binaries) at 1440/390px.
  **Gotcha**: Vite once served a stale compiled stylesheet after a full-file component rewrite
  (new markup + old CSS = "broken" screenshot); fix = `astro dev stop`, delete `apps/www/node_modules/.vite`
  + `.astro`, `start`.
- **SDK audit verdicts (verified, not yet fixed)**: license contradiction UNLICENSED vs public+provenance
  publish (needs human license choice); hand-maintained `openapi-definitions.mjs` (drift risk — wants a
  contracts→OpenAPI generator); SMS read endpoints are camelCase on the wire per `@app/contracts` while
  email/webhooks are snake_case — normalization = coordinated pre-1.0 breaking change (deferred);
  CLI beta.1 vs SDK beta.5 skew; playground pins a vendored tgz.
- Reviewer false positive to remember: "SMS camelCase is a bug" — it matches the real contract
  (`packages/contracts/src/sms.ts:30-41`, `services/api/src/sms/sms-read.ts:73`).

## Earlier (2026-07-24): apps/www — SDK-only docs + landing redesign (committed, not pushed)

Branch `feature/ops-www-scaffold`, commit **`9c61e91`** (45 files, +2630/−521). All pre-commit guards
passed (branch-name, file-length, browser-safe, biome, commit-msg). **Nothing pushed** — needs a human
go for the shared ref. Dev server: `apps/www` runs a **daemonized** `astro dev` on **:3400** —
`pnpm --filter @app/www start | stop | status | logs` (added this session).

- **Docs (ADR-0009 w-3) — full SDK-first IA, verified against the real SDK surface** (`packages/sdk`):
  get-started (+ sandbox-and-keys, authentication) · quickstarts (Node/Next/CLI) · messaging (SMS,
  sender-IDs w/ GH-NG registration, delivery-reports, message-definitions) · email (domains-DNS,
  templates, deliverability) · webhooks (events, signatures, retries-idempotency) · SDKs & tools
  (Node, CLI) · guides (OTP, transactional, broadcast, two-way) · account (wallet-billing, rate-limits
  **120/min key + 600/min tenant, real numbers**, going-live, compliance GH-DPA/NG-NDPR). **SDK-ONLY
  directive**: removed API-reference / curl / OpenAPI / Postman pages; sidebar restructured. Two
  read-only recon agents mapped the surface first — facts corrected drift (managed vs SMS delivery
  states, webhook event names, wallet shape). Honesty holds: inbound/two-way labelled **sandbox-only**
  (no live MO); no MCP page (none exists); DNS record values marked illustrative.
- **Landing (`src/pages/index.astro`) — guided product story**, visual language preserved (indigo/gold,
  Clash Display, dotted canvas, floating cutouts): hero (dispatch illustration as product-hero, floats)
  → why-Fabric → honest engineering-trust strip (NO fabricated metrics — real guarantees only) →
  **signature Lifecycle scroll** → developer-experience (live `InteractiveDemo`) → platform capabilities
  → reliability+security → pricing (wallet flow) → coverage (map + legend) → dashboard preview →
  business workflows (fintech/ecom/saas + restored `connected-people` webp) → quickstart → FAQ → CTA →
  expanded footer. Spacing-scale tokens `--section-y`/`--head-gap`/`--card-pad`.
- **Signature Lifecycle** (`src/components/il/Lifecycle.astro`): native-scroll sticky stage that swaps
  7 stage cards (code → render → reserve/queue → SMS → email → webhook → analytics) as a **connected
  progress thread** advances — vertical fill, three-state nodes (done filled / live glowing ring /
  upcoming muted), and a card→thread connector anchored to the pinned card (dot on the thread).
  IntersectionObserver-driven, reduced-motion safe, keyboard/SR-friendly.
- **Illustrations**: user generated transparent raster in ChatGPT GPT-5.6 (dispatch/architecture/
  coverage/wallet/reliability) — no image-gen tool exists in-session (Canva/Figma/mcp-image all
  ruled out; mcp-image needs a Gemini/OpenAI key the user lacks). Optimized to webp via `astro:assets`
  (`src/assets/il/`). Dashboard mock is `src/components/il/Dashboard.astro` (SVG/HTML).
- **NOT independently reviewed** (codex credits out, gemini dead) — self-reviewed build + visual (Chrome).
  Remaining keynote chapters deferred: bold trust band, section transitions, richer dashboard, footer
  ecosystem.

## Latest (2026-07-21): sandbox program kickoff (SDK-007→008→010) — design only, no code

`dev` clean at `21c9c8c` (= origin/dev). **PR #158 MERGED, CI green** — the closeout section below is
retained but its "PR #158 OPEN" framing is superseded.

- **Independent completion audit of SDK-001→005 done** (user asked for hard assurance). Ran a read-only
  adversarial sweep on gemini (free bucket) against real code + tests, then verified its one adverse
  finding on Opus. Result: **SDK-001→005 genuinely COMPLETE** — real tables/RLS, registered endpoints,
  BullMQ workers + cron with production callers, real-Postgres idempotency/crash-recovery/ledger tests,
  real dashboard surfaces (no mock backing). Gemini's lone "GAP" (`definitions:write` unenforced api-key
  scope) was a **false positive** — it conflated `apiKeyScopeValues` (has only `definitions:read`) with
  the *membership* catalog (`permissions.ts:29`, where `definitions:write` correctly lives). Audit
  report: `scratchpad/audit-report.md`.
- **SDK-006 confirmed NOT done** (verified in code, not docs): no managed live-promotion path, no
  `sdk-006.md` evidence, managed send dispatches only through the sandbox Virtual Phone. Live SMS +
  npm publish stay redlined (human go).
- **Direction chosen (user): option 2 — the sandbox program SDK-007 → 008 → 010.** Build the full
  managed Email + cross-channel routing + SMS Journeys surface against **fakes**, with every live path
  (SDK-006/009/011) deferred to admin-console config behind the live redline. Hard guardrail restated:
  **no visible-but-dead live control ships** (backlog §Delivery policy 40–55) — live surfaces stay
  absent until their real execution path exists and is tested.
- **SDK-007 readiness + slice-0 written (NON-CODE, awaiting sign-off):**
  `docs/sdk/sdk-007-readiness.md` + `docs/sdk/sdk-007-slice0-design.md`. Built on an independent reuse
  map (`scratchpad/reuse-map-report.md`, gemini) with every file:line re-verified on Opus. Key findings:
  the managed engine was built **channel-aware** — `message_deliveries`/`_attempts` already carry a
  `channel` column with channel-neutral containment FKs; only two CHECK constraints pin `channel='sms'`
  (`managed-messages.ts:78,:173`). Direct Email exists + is sandbox-gated (`FakeEmailProvider`,
  `email.service.ts:175`). So Email is an **extension, not a rebuild**.
- **Locked design (Opus calls):** extend-don't-fork channel dispatch (SMS→SMS engine, Email→the existing
  FakeEmailProvider path); additive schema (`channel` col on versions, relax CHECK to `IN('sms','email')`,
  polymorphic `emailVariantContent`); SDK-004-**AC02 channel narrowing closes here** (completion
  condition); **light ADR-0005 amendment** (channels were already reserved in the model — not a new ADR);
  7-slice decomposition, feature invisible until the release gate.
- **User decisions captured:** Email sandbox pricing = **size-tiered** (rendered-byte bands 50/150/256
  KiB, hard-ceiling blocker over 256 KiB, pure `rateEmailBySize` beside `rateSegments`); next step =
  **slice-0 design note then STOP** (done — this is that stop point).
- **ADR-0005 Amendment A1 RATIFIED** (product owner, 2026-07-21) — recorded in the ADR; the two locked
  decisions (size-tier boundaries + channel model) are signed off.
- **Slice 1 DONE + committed** (contracts + schema + compat + migration `0083` + tests). Additive,
  feature invisible: `messageChannel`/`emailVariantContent`/`messageVariantContent` exported for later
  slices but the version RESPONSE DTO stays SMS-shaped (zero ripple to dashboard/preview/SDK); `channel`
  column on versions (default `'sms'`, backfills) + CHECK; delivery/attempt CHECKs relaxed to
  `IN('sms','email')`; `analyzeDefinitionCompatibility` gains `channel_removed`. Gates: typecheck +
  unit (contracts 61 / domain 74 / api 157) + biome + **real-Postgres integration 14/14** (incl. 3 new
  channel/CHECK tests). Independently reviewed (gemini): APPROVE-WITH-NITS, all nits dismissed
  (already-addressed / deliberate slice-boundary / against repo CHECK convention).
  - **Local DB gotcha found + fixed:** the docker `postgres` container was running with **no published
    host port** (`docker ps` showed `5432/tcp`, not `0.0.0.0:5432->`), so `127.0.0.1:5432` refused all
    connections. `docker compose down && up` (volume preserved) republished it. Creds:
    `app_owner:localdev` (SUPER) + `app_runtime:localdev_app` (APP), db on `127.0.0.1:5432`. The full
    `test:integration` tier also has pre-existing local-data pollution (leftover `email_*` fixtures block
    account-delete teardown in unrelated suites) — run the target spec in isolation to see it green.
- **Slice 2 DONE + committed** — pure `@app/domain` Email render + preview core. `rateEmailBySize`
  (size-tiered: base×{1,3,6} at 50/150/256 KiB bands, `EMAIL_MAX_BYTES` ceiling, `EmailPayloadTooLargeError`,
  GHS/NGN/USD base table) in `rating.ts`; new `email-render.ts` (`previewEmail`: subject/text/html render,
  **HTML-escapes variable values in the html context, rejects CR/LF in the subject = header-injection
  guard**, byte-size measure via `TextEncoder`, tier pricing, path-coded blockers that never echo the
  value); new `message-preview.ts` (`previewMessage` channel dispatcher). Shared token/validation helpers
  (`TOKEN`, `resolve`, `pathIsDeclaredScalar`) exported from `message-render.ts` so both channels use one
  grammar (parity). 15 new unit tests (escaping vs plain-text context, header-injection, size ceiling,
  tier pricing, no-PII-echo, determinism, dispatch). Gates: domain typecheck + 89 tests + biome, files
  under length guard. Pure functions — no integration tier. **Not yet independently reviewed** (slice 1
  was).
- **Slice 3 DONE + committed** — Email branch of `POST /v1/messages/preview`. `previewMessageResponse`
  gains `channel` + nullable `email_preview` (SMS `preview` unchanged → dashboard SMS parse unaffected);
  service selects `channel`, **LEFT-joins** the SMS sender binding (Email has none), branches: email →
  `resolveEmailParts` (locale) → `previewEmail`, `sender.status="not_evaluated"` + no SMS compliance
  (email sending-domain binding deferred — honest readiness gap). READ-ONLY. Gates: contracts/domain/api/
  dashboard typecheck + api unit 157 + biome + **real-Postgres preview 7/7** (2 email + 1 regression).
  Independently reviewed (gemini, per the always-review directive): verdict CHANGES-NEEDED →
  **Blocker fixed** (LEFT join let an SMS release with no binding preview an empty sender instead of 404;
  restored the 404 + regression test). Dispositioned: required `channel` = additive at runtime (old SDKs
  strip unknowns; internal typecheck clean) — kept; OpenAPI "drift" = non-issue (`openapi:check` current,
  generator doesn't derive this response's fields); `as EmailVariantContent` nit = matches existing
  `as SmsVariantContent` pattern. Reviewer confirmed LEFT-join tenancy safe + skip-email-compliance is a
  valid incremental disposition.
- **Slice 4 (managed Email send) — decomposed into reviewed sub-slices** (money vertical; user ratified
  the approach: extract a shared channel-neutral acceptance core + per-channel nullable FK, NOT a fork of
  the shipped SMS engine):
  - **4a-i DONE + committed** — channel-neutral acceptance core + per-channel attempt FK. Schema:
    `message_delivery_attempts.email_message_id` FK→`email_messages` + a CHECK that exactly the
    channel-matching ref is set (migration `0084`, additive). `persistManagedAcceptance` generalized with
    a `channel` param (delivery/attempt channel + per-channel message ref + outbox message_id derived
    from it); `prepare-send.ts` passes `channel:"sms"`. **SMS money path provably unchanged** — sms-engine
    typecheck + 4 unit + **18 managed-SMS integration tests** (idempotent replay, concurrent-collapse,
    rechecks, negatives, crash-recovery) all green. Independently reviewed: APPROVE, no findings (SMS
    identical, 0084 safe on existing data).
  - **4a-ii DONE + committed** (`739b61e`) — Email accept/persist path. One tenant tx inserts an
    `email_messages` row (id = deliveryId, symmetric with SMS), stores rendered subject/text/html in the
    `SendEmailRequest` vault shape the dispatch worker already reads, reserves the wallet by the slice-2
    tier price (`referenceId` = deliveryId), records the `email_dispatches` intent, then calls the shared
    `persistManagedAcceptance(channel:"email", emailMessageId)`. **Replay-check-first ⇒ no double-reserve;
    every insert `ON CONFLICT DO NOTHING`; `message.accepted` outbox only** (NOT the direct path's
    `message.created` — managed uses accepted, like SMS). `ManagedMessagesService.send` now dispatches on
    `preview.channel`. Migration `0085` + mirror unique index on
    `message_delivery_attempts(email_message_id)` (NULL-distinct, SMS rows don't collide). ACCEPT ONLY —
    dispatch worker is 4b. Two files split to hold the length guard: `managed-send-plan.ts` (pure
    send-planning helpers) + `email-managed-accept.ts` (the accept core).
    - **OPEN DESIGN POINT RESOLVED (both decisions user-signed-off):**
      1. **`to` = `z.union([e164, emailAddress])`** — one field, no fork; unchanged `messages.send`. The
         DEFINITION's channel is authoritative; `to` is validated against it pre-acceptance (mismatch →
         400 `recipient_channel_mismatch`, **no PII echo**). No email-recipient compliance yet (matches
         slice-3 `not_evaluated`).
      2. **`from` authored on the definition** (`emailVariantContent.from`, optional) with a **synthetic
         sandbox fallback** `no-reply@sandbox.fabric.dev` when absent. Grounded in a real-world email study
         (SPF/DKIM/DMARC + verified sending domain = the authority layer; template carries a default
         sender): the authored `from` is the template-default pattern; the **domain-binding + DNS
         verification gate is the honest deferred readiness gap (4b/4c)** — sandbox never hits a real MTA
         (`FakeEmailProvider`), so no dead live control ships.
    - **Verified:** managed email spec 7/7 + managed SMS spec 10/10 real-Postgres (17/17 after the file
      split), full api integration 180 pass (only the 2 documented pre-existing local-env failures:
      retention fixture pollution + `senders` missing `DATABASE_URL_PROVISIONER`), api typecheck,
      `db:assert:drift`, biome, file-length guard. **Independent review (gemini):** all 9 money/idempotency/
      tenancy/PII/CHECK/migration points OK, NOTHING BLOCKING — findings cross-checked against the diff.
      **Committed on `feature/ops-sdk007-email-sandbox`; nothing pushed, no redline crossed.**
  - **4b-i DONE + committed** (`73cbf30`) — managed Email dispatch **money resolution**. New
    `email-managed-resolve.ts` `reconcileManagedEmailTerminal`: looks up the attempt by
    `email_message_id` (no row ⇒ direct email, no-op), then **delivered ⇒ commit / undelivered|failed|
    expired ⇒ refund** (idempotent, `referenceId` = deliveryId = email message id — works because 4a-ii
    reused `reserve()`'s `sms_reserve` ledger reason). Updates attempt + delivery status +
    `resource_version`; cost columns untouched (email price fixed at accept). No extra outbox —
    `resolve()` already emits `message.updated` keyed by `message_id` (= deliveryId). Wired into
    `EmailService.resolve` inside its existing tx, after the terminal-freeze guard (no double-settle;
    commit/refund independently idempotent). Mirrors SMS `engine.ts:resolveMessage`. FakeEmailProvider
    test hooks: `reject@`⇒undelivered, `fail@`⇒failed, else delivered. **Verified by me:** dispatch 6 +
    acceptance 7 + managed SMS 10 + direct email 5 = **28/28 real-Postgres**, api typecheck, biome,
    file-length. **Independent review (gemini):** money-direction/double-settle/direct-email/tenancy/
    outbox OK; the reserve-reason SUSPECT was a false positive (the passing commit test proves the
    reservation is found); a pre-existing **unlogged `enqueue().catch(()=>undefined)` in the direct
    `send()`** (SMS logs the equivalent deferral) is out of 4b-i scope — **FOLLOW-UP: add the deferral
    log to email `send()`** for Redis-outage observability. Committed, nothing pushed.
  - **4b-ii DONE + committed** (`ce12fbb`) — managed Email attempt-time recheck + TTL crash-recovery
    sweep; both refund through the 4b-i reconcile (no second refund path). Recheck
    (`email-dispatch-recovery.ts emailDispatchBlockReason`): re-checks `platform.email_sending` before
    provider contact, block ⇒ `resolve('failed')` (refund for managed / plain fail for direct), NO
    provider contact; **email has no consent/opt-out** (that catalog is phone-keyed via `hashMsisdn`), so
    kill-switch is the only recheck; **fail-open** on store error. Sweep (`sweepManagedEmailExpired` +
    `EmailService.sweepStuck`): managed-only (`EXISTS message_delivery_attempts`) stuck-past-TTL ⇒
    `expired` ⇒ refund once, zero provider contact; wired into `maintenance.service runSweep` via
    `maintenance-email-sweep.ts` (provisioner read-only discovery — `0063`/`0082` grant `app_provisioner`
    SELECT on email_messages/attempts — then per-tenant `withTenant` mutation, try/catch-continue).
    `assertSandboxEnvironment` extracted to `email-environment.ts` (email.service now 295 lines).
    **Verified by me:** recovery 6 + dispatch + `maintenance.integration` (real provisioner sweep path) +
    managed SMS = **26/26 real-Postgres**, api typecheck, biome, file-length guard. **Independent review
    (gemini):** recheck/refund/double-refund/scoping/tenancy OK; the provisioner-RLS SUSPECT dispositioned
    **two ways** (0063/0082 policies + the passing `maintenance.integration`); no module cycle
    (`email.module` has no maintenance import); the pre-existing `enqueue().catch` is cleanup-debt #3.
    Committed, nothing pushed. **Slice 4b (money vertical for dispatch) COMPLETE — accept (4a-ii) +
    settle/refund (4b-i) + recheck/crash-recovery (4b-ii) all shipped.**
  - **4c DONE + committed** (`3d3927c`) — Email authoring through the message-definitions API
    (channel-polymorphic). Contracts (Opus): create/add-version requests → `z.discriminatedUnion(
    "channel")` (SMS arm keeps `sender_id`, Email arm has none — email sender identity is `from` on the
    content); `messageDefinitionVersion` response gains `channel` + `content` = SMS|Email union
    (consumers narrow on `channel`); variable-schema subset extracted to
    `message-definition-variable-schema.ts` (re-exported, length guard). Service (codex): create/
    addVersion persist `channel`, sender-binding SMS-only, **channel immutable across versions**
    (`channel_immutable` before the compat check, real channels to `analyzeDefinitionCompatibility`),
    publish requires a sender binding only for SMS (email publishes without one). Dashboard **SMS-
    narrowed** (Opus, taste): channel-guarded content reads, SMS unchanged, email version → read-only
    stub, Edit hidden for email, create dialog sends `channel:"sms"` — **rich email authoring UI is
    4e**. **Verified by me:** api email/definitions/preview 17/17 + dashboard route specs 12/12 real-
    Postgres, contracts/domain/api/dashboard typecheck, file-length + browser-safe, OpenAPI regen +
    `openapi:check`, biome. **Independent review (gemini, full diff after 4 tooling-flake retries): 15
    files all OK, NOTHING BLOCKING**; lone nit = a test-only `as unknown as AuditService` mock cast.
    Committed, nothing pushed.
  - **4d DONE + committed** (`7f44207`) — test-only hardening (no production change). Preview↔send
    **byte-parity** (vault-stored send subject/text/html identical to the managed preview incl.
    HTML-escaped vars; reserve + delivery/attempt cost == preview.cost_minor); send-boundary negatives
    (oversized / subject-newline header-injection / invalid-vars) each with a before/after side-effect
    snapshot proving nothing persisted + no PII echo; **both tracked coverage gaps closed** — email
    concurrent same-key race (3 → one delivery+attempt+email_message+reserve) + recheck fail-open unit
    (throwing kill-switch → proceeds). Verified by me: 18/18 real-Postgres + 3 fail-open unit, guards,
    biome. NOTE: independent-review tooling (gemini/codex) flaked repeatedly this session; for this
    test-only slice self-review of the (substantive, non-vacuous) assertions stood in. Committed.
  - **4e DONE + committed (2026-07-22)** — email authoring end-to-end, decomposed + independently
    reviewed like the 4a/4b pattern:
    - **4e-i (`f285786`)** — SDK managed Email support. `MessagePreview` gains `channel` + `emailPreview`
      (new `EmailPreview` type + `parseEmailPreview`); `MessageDelivery`/`Attempt` channel `sms`→`sms|email`;
      `send()` accepts email OR E.164 via `requireRecipient`. `release:check` green. Codex review: nothing
      blocking.
    - **4e-ii (`a8a4eb5`)** — dashboard Email authoring UI. Channel selector (create-only, immutable on
      edit/version); `EmailContentFields` (from/subject/text/html) + `EmailLocalizedVariantsEditor`
      (per-locale partial overrides); `EmailPreviewPanel` renders via the pure `previewEmail` (preview↔send
      parity) + server "check released"; Edit enabled for email; `email-authoring.ts` (token spread across
      subject+text+html, `buildEmailContent` with a code-point subject-header-injection guard). 71 dashboard
      tests (9 new email-authoring unit + 2 route). **Codex review found + fixed one Medium**: the email
      preview recipient field would 422 against the E.164-only `previewMessageRequest.to`; removed the field
      (email eligibility is not recipient-keyed — no consent/opt-out, sender `not_evaluated`).
  - **SDK-007 CLEANUP DEBT — ALL CLEARED (2026-07-22), before slice 5:**
    1. **`sms_reserve` → channel-neutral `message_reserve`** — DONE (`dfb5682`). Additive enum migration
       `0086` (`ADD VALUE IF NOT EXISTS`, sms_* retained); `reserve/commit/refund` write `message_*`;
       `reservedFor` matches `IN('message_reserve','sms_reserve')`. **Backward-compat proven** on real
       Postgres (`legacy-reserve-compat.integration.spec.ts`: a forged legacy `sms_reserve` reservation
       still commits + refunds). Codex money review: nothing blocking. **`0086` proven CI-applicable**:
       the full 86-migration journal applies `exit 0` on a fresh throwaway DB (enum lands the 8 correct
       values). The local dev DB's pre-existing `__drizzle_migrations` desync (records ended at `0082`)
       was reconciled — `drizzle-kit migrate` now completes `exit 0` locally too.
    2. **`email.service.ts` re-org** — DONE (`6048cbe`). Extracted `/v1/email` reads to `email-reads.ts`;
       service now a 284-line orchestrator.
    3. **Unlogged `enqueue().catch` in direct email `send()`** — DONE (`6048cbe`). Logs the deferral now.
    4. **Evidence consolidation** — DONE (`4df0e5e`). One `docs/sdk/evidence/sdk-007.md` (slice ledger +
       AC01–AC05 traceability); the three slice fragments removed.
    5. **Coverage gaps** — DONE in 4d (`7f44207`).
    6. **Lost `acceptManaged` doc-comment** — DONE (`6048cbe`), restored during the §2 re-org.
  - **SLICE 5 DONE + committed (`436c400`, 2026-07-23) — SDK-007 FULLY CLOSED (all ACs AC01–AC05).**
    Channel narrowing closes AC04 + the inherited SDK-004-AC02. Contracts: catalog `channels` widened to
    `array(messageChannel)`, `previewMessageRequest` gains optional `channel`. API: catalog emits the real
    per-definition channel; the preview service (single choke point for preview + managed send) rejects a
    mismatched asserted channel with 400 `channel_mismatch` — also fixed the latent
    `sendManagedMessageRequest.channel` accepted-but-dropped smell. CLI manifest accepts sms|email. SDK:
    `CatalogPreviewOptions.channel` narrows to the key's channel; `catalog.type-test.ts` `@ts-expect-error`
    fixtures prove a wrong-channel literal fails to compile. Verified: SDK 41 + release:check, CLI 6, api
    typecheck + unit 161 + real-Postgres preview(channel-mismatch)/managed/catalog, biome, OpenAPI current.
    Codex review: nothing blocking. Evidence: `sdk-007.md` (all ACs closed), `sdk-004.md` AC02 → implemented.
    **Remaining for SDK-007 are redlines only: npm publish + live Email (SDK-009).**
  - **Local DB fully healthy (2026-07-23):** the pre-existing `__drizzle_migrations` desync was reconciled
    and `0086` proven CI-applicable on a fresh DB; `drizzle-kit migrate` now `exit 0` locally. The stale
    `delivery-retention` fixture was fixed (`98c8930`).
- **ADR gate for later:** SDK-008 (routing state machine) and SDK-010 (Journey run/step/wakeup state
  machine) each need their OWN ADR — flagged, not written yet. SDK-010 also has NO backend today (zero
  `journey` rows/controllers/services); its frontend React Flow canvas + palette are reusable, but it
  persists only to localStorage (`fabric.journeys.draft.v1`) — the mock debt SDK-010 retires.

## Earlier (2026-07-18 → 07-21): SDK-003/004/005 closeout — PR #158 MERGED (21c9c8c)

Branch `fix/ops-sdk004-closeout` (off `dev`), **pushed 2026-07-21, PR #158 → dev, MERGEABLE, CI
running** (`verify:push` passed on push). 12 commits. fifi ff-merges `dev` — do not self-merge.
**Closing out already-shipped work rather than starting new scope.** This HANDOFF was stale: it recorded slice 6b as deferred and SDK-004 as the
next item, but **both landed in `dbfd7d1` (PR #144)** — `packages/cli` (binary `fabric`) is built,
tested, and gated by `release:check`.

- **`docs/sdk/evidence/sdk-004.md` written** (was missing entirely — under the backlog's completion
  audit an item without traceability evidence is not closed). AC01/AC04/AC06 traced to
  `packages/cli` specs; AC03 to the shared `@app/domain` validator via SDK-003 evidence.
- **AC05 was only half-proven.** The forward direction (send-only key denied the catalog) existed;
  the reverse (a `definitions:read` key cannot send/publish/retrieve content) did not. Added a
  closed-catalog denial test in `api-key.guard.spec.ts` that iterates `apiKeyScopeValues`, so a
  newly added scope fails the test until deliberately considered.
- **Defect found + fixed:** `definition-developer-setup.spec.ts` was a tautology — it compared
  `DEFINITION_COMMANDS` to literals copied from the same module and would have survived renaming the
  binary, the package, or either subcommand. Rewritten to assert against `packages/cli/package.json`
  (`name`, `bin`) and the subcommands `bin.ts` actually accepts.
- **AC02 channel clause is OPEN and needs a release-owner decision.**
  `DefinitionContract.channels` is declared but consumed by no type — `CatalogPreviewOptions` narrows
  only `data`/`locale`, and no send/preview option exposes `channel`. Not a missing test: the
  constraint does not exist. SMS is currently the only managed channel, so nothing can select a wrong
  one, but the no-waiver rule requires either implementing it or recording a reviewed
  non-applicability with a named reviewer (defensible disposition: defer to SDK-007/008).
- **`docs/sdk/evidence/sdk-003.md` reconciled** — AC02 (permission-gated member-draft /
  developer-read-only) and AC07 (`templateToDefinitionDraft`, pure, original untouched) now trace to
  6b evidence instead of reading "deferred".
- Also carries a small `webhooks.service.ts` refactor found uncommitted on `dev`: the nested ternary
  env-scope filter extracted to guard clauses per CLAUDE.md §3. Behaviour identical; typecheck green.

**Verified:** `@fabric-messaging/cli release:check` exit 0 (typecheck + 6 tests + build + packed
smoke + pack dry-run) · api 30 files/156 tests · dashboard 13 files/60 tests · api + dashboard
typecheck exit 0. **Nothing pushed, nothing published.**

### Follow-up sweep (same branch)

Worked the outstanding follow-ups rather than opening new scope. Two were already done; two were
real.

- **Insights aggregation test — DONE.** `sms/messaging-insights.integration.spec.ts`, 4 real-Postgres
  tests: workspace-wide rollup excludes another tenant's rows (RLS), the environment predicate
  narrows, counts/avg_segments are exact, and error codes group heaviest-first with an **unmapped
  code falling back to the raw code** — the standing guard against reintroducing the fabricated
  Twilio-shaped descriptions #153 removed. Full integration tier now 40 files / 168 passing.
- **Member-mutation audit — ALREADY DONE, note was stale.** `invite` / `updateRole` /
  `setPermissions` / `remove` all emit distinct audit actions, and the actor is wired end-to-end:
  BFF route (`session.email`) → `members-client` `x-actor-email` header → controller `@Headers` →
  service → audit. `members.service.integration.spec` asserts the acting admin's email on a
  permission grant. Nothing to build.
- **Playground `messages.*` — DONE.** `messages.preview` / `send` / `retrieveDelivery` added to
  `playground-core.mjs` and the UI (new "Managed messages" group), so SDK-005's managed surface is
  finally exercisable from the playground. Verified the vendored SDK (`beta.5`) exports all three.
- **⚠️ Playground live-write guard was DEAD — FIXED.** The guard read
  `fabric.environment === "production"`, but SDK-001 removed `production` from the public vocabulary
  and `environmentForKey` only ever returns `sandbox | live`. The comparison could never be true, so
  **a live key could mutate through the deployed playground regardless of
  `FABRIC_ALLOW_LIVE_WRITES`.** Now compares against `"live"`. This one is worth a redeploy of
  `fabric-playground-red` on its own merits — it protects the live-SMS/payments redline.

**Env gap (local only, pre-existing):** `senders.integration.spec` fails on this machine because the
local `.env` carries only `DATABASE_URL_APP` + `DATABASE_URL_OWNER`. `.env.example` already
documents all four — copy its `DATABASE_URL_SUPER` and `DATABASE_URL_PROVISIONER` lines across and
the tier runs clean. Nothing to change in the repo. (Until then, run the tier with
`DATABASE_URL_SUPER="$DATABASE_URL_OWNER"`.)

### SDK-005 AC05/AC07 closeout — and a live 500 found (2026-07-19)

Same stale-evidence pattern as SDK-003/004: `sdk-005.md` still recorded **AC05** and **AC07** as
partial even though the work closing AC07 (dashboard delivery surfaces, typed webhook UAT) was
already struck through as DONE further down the same document. AC05 was genuinely open — the
managed-specific negative tests were never written.

- **`messages/managed-negative.integration.spec.ts` — NEW, 3 tests.** Suppressed recipient → 400
  `recipient_opted_out`; underfunded wallet → 402 `insufficient_funds`; solvent control send → 202.
  Each negative asserts message/delivery/attempt/outbox counts are unchanged, and the control send
  stops the negatives passing for the wrong reason.
- **⚠️ Defect found by that test: insufficient funds returned an opaque 500.** The wallet's
  `InsufficientFundsError` was mapped nowhere in `services/api` — grep confirms zero references —
  so an empty wallet produced a server fault the SDK could not branch on, even though
  `insufficient_funds_error` (402) has been a declared `ErrorType` in `@app/contracts` since F8.3,
  and `packages/wallet/errors.ts` claims "the API boundary maps these" (a lying comment). Added
  `insufficientFunds()` to `http/api-error.ts` and mapped it in `ManagedMessagesService.send`.
- **The direct `sms.send` path has the SAME bug and is NOT fixed.** It also lets the wallet error
  escape unmapped. I scoped the fix to the managed path because AC05 mandates it there, whereas
  changing the status code of a shipped, deployed endpoint (500 → 402) is a public behaviour change
  that deserves an explicit call. The helper is in place, so the direct fix is a small catch block.
- **Scope calls recorded rather than silently skipped:** quiet hours stays proven at the pure-function
  tier (`promoWindowOpen` reads the wall clock and preview takes no injected `now`, so an HTTP test
  would pass/fail by time of day); sandbox sender status cannot block by design (`virtual: true`);
  **kill-switch is post-acceptance only** — `assessSendCompliance` never consults it, so a
  pre-acceptance gate would be a behaviour change to specify, not a missing test.
- `managed-messages.spec-harness.ts` gained an optional `fundMinor` so an underfunded tenant can be
  seeded; default unchanged.

**Verified:** api integration 41 files / 171 tests (only the local-env `senders` failure) · api unit
30 files / 156 tests · typecheck 0 · biome clean.

**ADR-0005 and ADR-0006 ACCEPTED 2026-07-19** (product owner) — the blocker that was overdue against
the backlog's own residual-decisions table is cleared. Both were ratified **retrospectively**: the
model and its acceptance/money/idempotency semantics had already shipped across SDK-003/004/005 under
explicit per-slice gos, so acceptance confirms the built system matches the decision rather than
authorising unstarted work. Both status lines record that framing rather than implying a clean
review-then-build sequence.

**Scope security review DONE 2026-07-21** (`docs/sdk/scope-security-review.md`) — the last open
ADR-0005 follow-up. It found and fixed a **MEDIUM privilege-escalation**: the management gate
(decision #6) separated dashboard-session authority from runtime-key authority using the proxy
`applicationId === null`. But `api_keys.application_id` is nullable (migration 0047; the planned
NOT-NULL follow-up never shipped), and `resolve()` returns `applicationId: null` for such a key — so
a legacy/un-backfilled runtime key, **regardless of scopes**, could author/publish/archive message
definitions for its tenant (within-tenant; RLS holds). Fixed by carrying an explicit `isSessionToken`
flag on `RequestTenant` (true only on the BFF tenant-token branch) and testing that at the gate
instead of the proxy. Regression: `message-definitions.controller.spec` "rejects a runtime key with a
NULL application_id"; guard specs assert the flag on both paths. One **LOW** noted (managed-delivery
reads use the same proxy but are scope-backstopped — read-only, same-tenant) and a defence-in-depth
recommendation to finally land the NOT-NULL on `api_keys.application_id`.

**Still open on ADR-0005's list:**
- **npm publication** of `@fabric-messaging/sdk@beta.5` and `@fabric-messaging/cli@beta.1` — a
  separate redline needing explicit human authorisation, independent of ADR status;
- **live rollout**, which stays behind the live-SMS redline regardless;
- SDK-004's **AC02 channel** implement-or-record-non-applicability call.

## Earlier (2026-07-18): stakeholder-testing hardening — customer journey verified end-to-end (PRs #151–#153)

All four apps live on the free testing stack (Neon + Render + Vercel). Swept the whole customer
journey with a real all-permissions **sandbox** key against the deployed API and closed every gap.
Each fix was deployed + re-verified in prod (API `fabric-jezz.onrender.com`, dashboard
`fabric-dashboard-teal`, playground `fabric-playground-red`). Stakeholders sign in with
`fabricservices8@gmail.com`.

- **#151** — (a) `verify.start` routed the OTP via the tenant/plan delivery mode, so a sandbox key
  demanded the live carrier (`live_provider_not_ready`); now threads the key's environment → routes
  virtual like `sms.send`. (b) `live_provider_not_ready` no longer leaks the carrier name ("Arkesel").
  (c) `messages:read`/`messages:send` added to the membership permission catalog + member baseline —
  the "Managed deliveries" nav was gated on a permission NO membership (not even owner/admin FULL)
  could hold. (d) Seed scripts now set `plan:"sandbox"`: the schema default `"free"` made the
  dashboard treat a workspace as **live** and hide every sandbox key/log/webhook/email, because the
  dashboard derives the shown environment from `session.plan === "sandbox"`. Live data corrected too.
- **#152** — (a) playground `email.*` was broken: it pinned published `@fabric-messaging/sdk@beta.3`,
  which predates the email resource (npm stops at beta.3). Vendored the workspace SDK `beta.5` as a
  packed tarball (`file:` dep) — **no public npm publish**. (b) `webhooks.create` 500'd for `sk_*`
  keys — it ignored the key's own application-environment and fell back to the app slugged `default`;
  a renamed app matched nothing → bare `throw` → 500. Now binds the key's environment; structured
  errors on the not-found paths.
- **#153** — Messages → **Insights** tab de-mocked: real `GET /v1/messages/insights` aggregates the
  tenant's `messages` (total_sent / delivered / failed / avg_segments + error breakdown). Was a
  hardcoded BFF stub (24,817 sent, Twilio codes 30008/30003…).

**Full SDK sweep green** (deployed API, sandbox key): sms.send/list/retrieve/sendBatch/retrieveBatch ·
email.send/list/retrieve · verify.start · wallet.retrieve · senderIds.list/create ·
webhooks.create/list/remove/verify/signAndVerify.

**Deploy mechanics (this stack):** Render API key is in Infisical (`RENDER_API_KEY`) — trigger a
deploy with `POST api.render.com/v1/services/srv-d9dfr6ernols73cbf0i0/deploys`, poll the deploy id
for status `live` (~5 min build). Vercel: `vercel deploy --prod` from the **repo root** with the
project linked (`--project fabric-dashboard|fabric-playground --scope in-hot`); the project's
root-directory setting drives the monorepo build. The REST token in auth.json goes stale (403
`invalidToken`) — the CLI auto-refreshes, so use the CLI, not raw REST.

**Follow-ups:** publish `@fabric-messaging/sdk@beta.5` to npm (redline — needs human go) so external
users get email; add an integration test for the insights aggregation; the playground has no
`messages.send` action so "Managed deliveries" can't be exercised from it; the shared sandbox test
key is to be revoked by the owner.

## Earlier (2026-07-18): ADR-0008 — Fabric-owned auth screens (WorkOS behind the scenes)

Branch `feature/ops-adr0008-custom-auth-screens` (off dev `2f457f6`, after ADR-0007 #146 merged).
ADR-0008 **accepted** — own the credential pixels, WorkOS stays the identity engine. Amends the
locked CLAUDE.md "we own no credential form" line (hosted AuthKit is now the FALLBACK, not the only
surface).

- **Slice 1 (`c3c03d2`)** — `@app/fe-auth/credentials.ts`: signInWithPassword, signUpWithPassword,
  verifyEmailCode, sendMagicCode + signInWithMagicCode, all wrapping WorkOS User Management APIs
  and funnelling through the SAME sealed cookie + resolve-v2 as the OAuth callback.
  `buildAuthorizationUrl` gains a `GoogleOAuth` provider (skips hosted, straight to Google). Typed
  `CredentialOutcome` (authenticated / verification_required+pending token / fallback_hosted /
  invalid_credentials / error). Passwords never stored/logged/thrown. 9 unit tests.
- **Slice 2 (`77aa001`)** — split-panel `/signin` + `/signup` (brand hero + form, Relay-style) and
  `/api/auth/*` BFF routes (sign-in, sign-up, verify-email, magic/start, magic/verify, google).
  `credentialResponse` sets the sealed cookie + workspace selector and routes by membership count.
  Per-IP + per-email rate limiting, fail-closed. `/login` → thin forwarder to `/signin` (still the
  registered logout URI; carries flash notices). **Verified live vs WorkOS Test env**: screens 200,
  bad password → invalid_credentials, SSO-domain email → fallback_hosted, Google → provider=GoogleOAuth.

**Deferred (ADR-0008 non-goals)**: passkeys + full custom MFA UI stay on hosted AuthKit; password
reset stays hosted (WorkOS v10 dropped sendPasswordResetEmail — custom reset would need our own
mailer). AuthKit branding already themed (indigo/#fcfcfd) as the fallback surface. **No new WorkOS
redirect-URI registration needed** — Google returns via the already-registered `/auth/callback`,
logout via the already-registered `/login`.

## Earlier (2026-07-18): ADR-0007 — user-level auth, in-app workspace selection (Stripe model)

Branch `feature/ops-adr0007-user-level-auth` (off dev `f1427c9`, after #145 merged). ADR-0007
**accepted** (owner sign-off) and implemented in 4 slices — WorkOS now authenticates the PERSON
only; tenancy lives exclusively in Fabric `memberships`:

- **Slice 1 (`cfc69d2`)** — `POST /internal/identity/session-v2` (subject+email → user + ALL
  memberships; verified stranger gets a bare user row, invited email binds + activates every
  pending invite in active accounts) + `POST /internal/identity/workspaces` (onboarding submit:
  account + owner membership + default app/envs + seeded sandbox credits in ONE local tx — **no
  WorkOS org**). Gates: signup kill-switch, verified email, throttle. 7 real-Postgres tests.
- **Slice 2 (`806b4ff`)** — fe-auth user-level path (`readUserSession`/`handleUserCallback`/
  `refreshUserSession*`); dashboard cut over. Active workspace = HMAC-signed selector cookie
  (`fabric-workspace`) that grants nothing by itself — every request revalidates the selection
  against the freshly resolved membership list before an AppSession/tenant token exists (fail
  closed). BFF routes unchanged (`orgId` = selected tenant).
- **Slice 3 (`beff11c`)** — branded `/onboarding` (user NAMES their workspace), `/workspaces`
  picker (replaces the WorkOS hosted org screen), sidebar workspace switcher (Stripe account
  picker; `POST /api/workspace/switch` validates membership server-side, rewrites only the
  selector cookie). AuthKit hosted screens themed to Fabric via WorkOS MCP (indigo #383a96,
  #fcfcfd canvas, System theme, sign-up name fields on).
- **Slice 4 (`95912e7`)** — org-less invitations everywhere (team invites + ops provisioning;
  role/tenancy = local rows only), ops provisioning is now one local tx (`workos_organization_id`
  stays null — reserved for future enterprise SSO), v1 org-scoped path DELETED (session +
  organization-for-user routes, self-serve adoption provisioner, fe-auth adoptOrganization).
  fe-auth's org-agnostic `resolveSession` no longer requires IdP org/role claims — required so
  the staff realm keeps working once users are detached from WorkOS orgs.

**WorkOS (Staging env) wiring done via MCP**: Vercel redirect/logout URIs registered per app
(dashboard `fabric-dashboard-teal.vercel.app`, admin `fabric-admin-console.vercel.app`; localhost
kept; dead CloudFront URIs dropped); admin-console Vercel `WORKOS_CLIENT_ID` fixed (was the
dashboard's) + redeployed. **Pending, deliberately sequenced AFTER deploy of this branch**: remove
the 5 org memberships in the 2 staging WorkOS orgs (org_01KXB4SH… "fabricservices8's workspace",
org_01KWP2NBAD… "Test Organization") — detaching before the relaxed fe-auth ships would break
logins on the deployed v1 code. Existing sealed cookies force one re-login (accepted, pre-launch).

## Latest (2026-07-15): SDK-002 — endpoint-specific webhook delivery

Branch `feature/ops-neutral-surfaces-template-seeds`. Committed `8f47945`, **local only — no push,
no package publication** (external gate intentionally closed).

- One durable delivery per (outbox event × endpoint). Worker commits a recoverable lease before
  network I/O, retries endpoints independently, keeps append-only attempt history, surfaces
  pending/dead health, and supports owner/admin **replay** (resets the dead cycle, preserves
  history, appends the successful attempt) with a `webhook_delivery.replay` audit record. Endpoint
  removal is a **soft disable** so evidence is retained.
- Outbound SSRF guard (`webhook-url-policy.ts`): resolve + pin the destination immediately before
  connecting (closes the DNS-rebinding gap), reject non-public targets and any multi-A set with a
  private member, HTTPS-only, no credentials/fragments, no redirect-follow, TLS validated, 10s
  timeout, response bodies never buffered. `WEBHOOK_ALLOW_PRIVATE_NETWORKS` override is **local-test
  only** — must never be set in a deployed env.
- Migrations `0067`–`0074` (deliveries + attempts tables, RLS on both). SDK + contracts + dashboard
  deliveries dialog/replay route + OpenAPI updated. DTO mappers extracted to `webhook-dto.ts` to
  clear the 300-line file-length guard.
- **Verification: full `pnpm verify` green** (guard, lint, typecheck, 141 API tests incl. webhook
  delivery/event-contract/HTTP/URL-policy suites, all 4 app builds). Real-Postgres RLS + drift gates
  passed. Evidence: `docs/sdk/evidence/sdk-002.md`. AC01–AC06 traced.
- Env note: `next build` standalone needs **Windows Developer Mode ON** (unprivileged symlink) — a
  prior verify run failed only on the admin-console sharp symlink until it was enabled; CI (Linux)
  unaffected.

**Next up — SDK-003** (author/version/release/**preview** managed SMS definitions). Planning committed,
**no feature code yet, BLOCKED on sign-off**:
- Readiness + 8-slice decomposition: `docs/sdk/sdk-003-readiness.md` (`f729494`). Reuse map: pure
  `@app/domain` `encodeAndSegment`+`rateSegments` reusable; **server-side renderer is net-new** (only
  exists client-side in `preflight.ts`); `sms-engine/engine.ts` is the side-effect boundary preview must
  not cross.
- Slice-0 design: `docs/sdk/sdk-003-slice0-design.md` (`9657b89`) — locks stable-key grammar, the
  portable closed JSON-Schema variable subset, and the pure `analyzeCompatibility` verdict table.
- Slice 1 DONE (`699a86e`) — proceeded on ADR-0005 per explicit go. `message_definitions` /
  `_versions` / `_releases` (migrations `0075` DDL + `0076` RLS): stable key unique per app
  case-insensitively, version immutability enforced by REVOKE (a default-privilege grant hands
  app_runtime full DML, so it must be revoked, not merely un-granted), one-release-per-env, composite
  containment FKs blocking cross-app/tenant releases. 9 real-Postgres invariant tests +
  `db:assert`/`db:assert:drift` green.
- Slice 2 DONE (`d4bfdc8`) — `@app/contracts` stable-key grammar + closed variable-schema subset
  (strict nodes reject `$ref`/`oneOf`; path-coded depth/size/count checks) + definition/version/release
  DTOs; `@app/domain` pure `analyzeCompatibility` (per-field breaking/compatible verdict + JSON paths).
  34 new unit tests.
- Slice 3 DONE (`8bb37a8`) — `@app/domain/message-render.ts`: pure `validatePayload` (subset →
  path-coded errors, never echoes the value) + `previewSms` (token-declared check → validate → render
  → `encodeAndSegment` → `rateSegments`, bounded, blockers ⇒ nothing rendered/priced). The single
  render source preview (slice 5) and SDK-005 send will share. 11 tests incl. preview↔send parity +
  no-PII-in-errors.
- Slice 4 DONE (`ec96a2d`) — `v1/message-definitions` create/list/add-version/publish/archive.
  Authority (ADR-0005 #6): operator or dashboard session (BFF token → `applicationId===null`); a
  scoped `sk_*` key is refused (`management_requires_session`). Breaking version rejected via
  `analyzeCompatibility`; publish upserts the single sandbox release + audits; live refused. 7
  real-Postgres + 5 controller-unit tests.
- Slice 5 DONE (`b13dd91`) — `POST /v1/messages/preview` resolves the released definition for the key's
  env and renders via the shared `previewSms` core; `sms:read` scope (a dedicated `messages:read`
  scope deferred); unreleased key → 404; invalid payload → path-coded blockers. No-side-effect
  integration (3) asserts messages/dispatches/outbox/PII counts unchanged; 3 controller-unit tests.
- Slice 6 core DONE (`d99c140`) — dashboard `/message-definitions`: server-only client + BFF routes
  (list/create/publish/archive/preview with owner/admin write gating + trusted-origin), a page with
  status/version/release state + per-definition Use-in-code snippet + publish/archive actions, and a
  create dialog (key + body + JSON variable schema validated against the subset). 6 route-handler
  tests (role matrix). **Slice 6b SHIPPED** in `dbfd7d1` — visual schema builder, interactive preview
  panel, template→draft conversion, and member-draft/developer-read-only gating, resolved via the new
  `definitions:write` / `definitions:publish` permissions (a developer's session role collapses to
  member, so the split had to be permission-based rather than role-based).
- Slice 7 DONE (`a126861`) — `@fabric-messaging/sdk` `MessagesResource.preview` (typed
  `MessagePreview`) wired + exported; `/v1/messages/preview` + schemas in the OpenAPI generator,
  both artifacts regenerated + `openapi:check` current; SDK contract-parity test; evidence doc
  `docs/sdk/evidence/sdk-003.md` (AC01–AC07; AC02 member-draft + AC07 template conversion deferred
  to slice 6b).

## Per-user permission management (2026-07-16, local, unpushed)

Admin-managed per-user permissions on top of the role model (resolves the "tell a developer from a
member" gap). Decisions: **full per-user override** (explicit set wins; role = template), **any admin
grants anything** (escalation trade-off — commented at the seam), **existing catalog** + new
`definitions:write` / `definitions:publish`. Safety rails: **owner is never editable** (no lock-out).

- `@app/contracts/permissions` — single-source catalog + role baselines + pure
  `baselinePermissions`/`effectivePermissions`. `memberships.permissions text[]` (migration `0077`;
  NULL = baseline, set = exact override).
- API: identity session = `effectivePermissions(override ?? baseline)`; `members.setPermissions`
  (owner-immutable); `PUT /internal/tenants/:id/members/:userId/permissions`. identity.service local
  role map removed (now one source with the dashboard).
- Dashboard: message-definitions BFF gates on `definitions:write`/`definitions:publish` (not role);
  Team page per-user permission editor (`MemberPermissionsDialog` + `PUT /api/team/.../permissions`,
  owner/admin gated). Commits `63ee169`, `61ccc48`, `0f15b56`.
- Baseline: member gains `definitions:write` (may draft), not publish; owner/admin get both;
  developer-access adds only api_keys/logs (so a developer cannot author definitions — the original
  ask, now enforced by permission, and an admin can override per user).
- **Follow-ups:** member mutations (incl. permission grants) are still **unaudited** in the members
  module (matches existing updateRole/remove — worth adding); a bounded-by-granter escalation rule if
  the "any admin grants anything" trade-off is revisited; slice-6b definitions UI still open.

**SDK-003 STATUS: slices 0–7 AND slice 6b COMPLETE — all seven ACs closed** (`dbfd7d1`, PR #144).
Full engine + API + SDK + OpenAPI + dashboard surface for author/version/release/preview managed SMS
definitions, plus the 6b dashboard depth (visual schema builder, interactive preview panel,
template→draft conversion, permission-gated member-draft / developer-read-only). Evidence:
`docs/sdk/evidence/sdk-003.md`. **SDK-004 also shipped in the same PR** — see
`docs/sdk/evidence/sdk-004.md` (one open item: the AC02 channel clause needs implement-or-waive).
ADR-0005 **accepted 2026-07-19** (was `proposed`); publication remains a separate redline.
- RESOLVED (2026-07-17): the `wallet/statement.integration` local failure was residue from crashed
  test runs (fixed-hash `api_keys` + tenant rows whose `afterAll` never ran, colliding on
  `uniq_api_key_hash`), not ledger drift. Stale tenants deleted; full API integration suite green.
- **Still open:** ADR-0005 is now `accepted` (2026-07-19), but its **scope security review** is not
  done — slice-0 §5 lists the asks. The runtime-vs-management authority split lands at the API layer
  in slice 4, not the DB grants, which is exactly what that review should scrutinise.
- Local-env note: this dev DB has `app_owner`/`app_migrator` table-ownership drift; running the
  migration needed a one-off `GRANT REFERENCES ON applications, environments TO app_migrator` (not in any
  migration — a single-owner DB, i.e. CI, does not need it). Also `drizzle-kit generate` emits composite
  FKs before the unique indexes they reference; the `0075` SQL was hand-reordered (indexes first).

## SDK-005 — managed message deliveries (2026-07-17, local, unpushed)

**Persistence boundary DONE + verified** (`00dda4d`): `POST /v1/message-deliveries` sends a released
definition by stable key through the two-phase SMS pipeline. Preview-gated eligibility; cost cap
fails closed pre-write; atomic delivery+attempt+message+outbox insert keyed on `Idempotency-Key`;
deterministic delivery id per tenant/app/env/key → identical replay returns the same resource with
no second reserve/attempt/outbox; payload mismatch on a reused key → 409 via request fingerprint.
Tables `message_deliveries`/`message_delivery_attempts` (migrations `0080`–`0082`): FORCE RLS +
provisioner policy, composite containment FKs, retention `expires_at` + `legal_hold`.

- Migration failure root-caused: drizzle-kit again emitted the attempts containment FK before its
  target unique index — `0080` hand-reordered (same quirk as `0075`). Second bug: the tenant-tx
  serializer rejects `Date` binds; `expiresAt` now binds `toISOString()::timestamptz`.
- Verified: 7-test real-Postgres spec (`managed-messages.integration.spec.ts`, seeding split into
  `managed-messages.spec-harness.ts`) incl. a **3-way concurrent same-key race → one delivery** and
  reconciliation assertions (inline sandbox resolution propagates delivered + exact cost +
  `resource_version` bump onto delivery/attempt); full API integration 158/158 + wallet/sms-engine
  tiers + unit suites + typecheck green.
- Also fixed (`1a8ccce`): flaky `webhook-http-client.spec` — 20ms shared timeout misclassified
  outcomes under parallel load; per-case timeouts now deterministic.
- **SDK surface DONE** (`e465876`): `fabric.messages.send(key, { to, data, idempotencyKey, … })` +
  `retrieveDelivery(id)` with catalog-generated per-key typing; parser proven against canonical
  `sendManagedMessageResponse`; OpenAPI paths/schemas regenerated; `release:check` green (39 tests).
  Definitions-page Use-in-code snippet now shows `send`.
- Evidence: `docs/sdk/evidence/sdk-005.md` (AC traceability; AC04/AC06 + purge job + dashboard
  delivery logs + packed-example UAT still open).
- **Delivery log DONE (list):** `GET /v1/message-deliveries` (summary rows, no recipient PII; sk_*
  key lists its own env, dashboard tenant token names `environment_id` + sms:read) + dashboard
  `/message-deliveries` page (per-application sandbox log, nav entry). Reads split into
  `managed-messages-reads.ts`. 8-test spec incl. list ordering + no-PII-in-list.
- **Retention purge DONE:** daily maintenance cron purges past-`expires_at` deliveries + attempts;
  `legal_hold` pins indefinitely; ledger/audit untouched; advisory-locked provisioner pass
  (`maintenance-retention.ts`); 2-test real-Postgres spec (purge/hold/fresh + no-op second pass).
- **Detail view DONE:** `/message-deliveries/[id]` — identity facts, masked recipient, exact cost,
  metadata, attempt timeline; list rows link through. Retrieve endpoint gained the same dual
  authority as list (sk_* own env / tenant token names app+env); 9-test spec incl. the
  tenant-token fail-closed + serve path.
- **Crash recovery PROVEN (AC04):** `managed-crash-recovery.integration` — accept → crash (no
  dispatch) → sweeper converges message/delivery/attempt on `expired`, terminal outbox event,
  exactly-one refund, zero provider contact. Full API integration now 37 files / 164 tests.
- **AC06 SHIPPED + PROVEN:** attempt-time rechecks on the queued dispatch path
  (`sms-dispatch-recheck.ts` — kill-switch/consent/sender re-checked before provider contact;
  block → refund-once + terminal event; fail-open on store errors). 3-test spec incl. replay
  no-op. Also fixed the REAL cause of the intermittent statement-spec failures: integration specs
  sharing raw API keys race on the globally-unique key_hash and authenticate as each other's
  tenants — keys de-duplicated/randomized; failure-path diagnostic left in the statement spec.
- **PR #144 MERGED to dev (`dbfd7d1`, 2026-07-17, CI green).** Continuing on
  `feature/ops-sdk005-closeout`.
- **Webhook status DONE (`3073099`):** `GET /v1/message-deliveries/:id/webhooks` (fan-out rows per
  outbox event — endpoint URL/state/attempts/last HTTP, secret never; containment 404) + dashboard
  Webhooks section on the detail page; shared `readScope` dual-authority helper. Also: queue-spec
  flake root-caused (dev-stack worker shares Redis, raced the spec's worker) → `REDIS_QUEUE_PREFIX`
  on QueueService + per-run prefix in the spec. Light canvas → near-white `#fcfcfd`.
- **Sandbox UAT DONE (2026-07-18):** `managed-sdk-uat.integration` — real SDK over real HTTP:
  send by key → worker fan-out → SDK-verified TYPED events (accepted + terminal delivered,
  tampered payload refused) → delivery/attempt/wallet reconcile to one logical message. Full API
  integration now 39 files / 169 tests.
- **DSR/offboarding DONE (2026-07-18):** erasure scrubs managed reference/metadata same-tx with
  the key destruction (money facts survive), summary counts managed deliveries, offboarding =
  soft-close + status-blind retention (proven on a closed tenant). 2-test spec.
- **SDK-005 SCOPE COMPLETE — all 8 ACs closed** (AC05 finished 2026-07-19; see the closeout section
  at the top of this file, which also records the 402 defect that closure uncovered). Full API
  integration 41 files / 171 tests. Evidence: `docs/sdk/evidence/sdk-005.md`. Next backlog: SDK-006
  (live provider path — behind the live-SMS redline) or SDK-010 (Journeys, unblocked). Packed-tarball
  UAT variant = nicety.

## Current direction (2026-07-12): PI-6 — self-service developer platform pivot

Product direction pivoted to a **self-service developer platform** (Stripe/Twilio/Resend-class).
Self-serve sign-up becomes the **primary** onboarding; ops-provisioning is demoted to an
**enterprise exception**; **dev-portal merges into the customer dashboard**; admin-console
tenant-invite-as-primary is removed. Plan: `docs/PI-6/PLAN.md`. Baseline: ~60-70% already exists
(PI-4 verify-first + ADR-0002 self-serve sandbox + ADR-0003 BFF tokens).

**Locked decisions (2026-07-12):** build a real **Workspace → Application → Environment** hierarchy
(**ADR-0004**, supersedes ADR-0002's flat sandbox-entitlement); landing = a **separate marketing
app**; SDKs **Node + Python** first; **Email + AI assistant deferred** to later PIs.

**Branch `feature/e14-workspace-hierarchy`** (off the E13 tip — depends on E13 landing in `dev`
first; then rebases). **Local commits only, NO push until the program is done** (user directive).
Milestones so far:
- ADR-0004 + PI-6 plan committed (`2301adc`).
- Foundation schema: `applications` + `environments` tables (migration `0045`) + RLS/grants
  (`0046`, provisioner + tenant_isolation). RLS boundary stays the workspace/tenant. Cross-tenant
  read/write denial + fail-closed proven — full db integration suite green, 34 tests (`337ae79`).
- Application/environment zod contracts in `@app/contracts` (`c537739`).
- Backfill flat→hierarchy: `cloud-backfill-app-env.ts` (in-image, runs as `app_provisioner` — the
  only cross-tenant role, since FORCE RLS binds even the owner and nothing has BYPASSRLS) + its
  in-VPC ECS task-def. Also re-points existing keys/webhooks. Verified on real Postgres, idempotent
  (`16b081d`).
- `api_keys` + `webhook_endpoints` gain `application_id`/`environment_id` (migration `0047`,
  nullable during two-step backfill) (`c523157`). API keys mint into the default app's env matching
  the key type; live keys gate on the live env being `active` (not on `accounts.plan`); `resolve()`
  + `req.tenant` carry app/env; 8/8 spec green (`a58d2f4`). Webhook endpoints scope to the default
  app's sandbox env (`8f6b512`).
- Both provisioning paths birth the hierarchy: self-serve → live env LOCKED (go-live unlocks); ops
  (enterprise exception) → live env ACTIVE. Converged with the backfill; self-serve spec asserts it,
  5/5 green (`7451ed8`).

- SMS routing keys on `environment.type` (sandbox env → virtual, never a carrier), not
  `accounts.plan`; `send()` uses the presenting key's env, falls back to plan-based for the BFF
  token path; sandbox-routing spec exercises the env pin, 4/4 (`912cd03`).
- Go-live unlocks the live environment (`locked→active`) — the functional gate live-key minting +
  live routing depend on; proposals spec asserts it, 8/8 (`f30a65a`).

**ADR-0004 FOUNDATION COMPLETE — the Workspace→Application→Environment model is in end-to-end:
schema, RLS, contracts, backfill, per-env keys/webhooks, converged provisioning, env-based routing,
go-live env-unlock. Every step tested on real Postgres. All committed, NOTHING pushed.**

Residual hardening (tracked, NOT core, no regression) — task #9:
- `outbox_events` gains `environment_id` + env-filtered webhook delivery (matters once multiple envs
  have live endpoints; delivery is tenant-scoped all→all today, unchanged from before).
- E13 `delivery_mode` moves from `accounts.settings` onto the environment once the dashboard has an
  env selector.

**Phase 2 (applications API):** `GET/POST /v1/applications`, `ApplicationsService.list/create`. New
app is born sandbox-active / live-locked; duplicate slug → 400; tenant-scoped (RLS). 4/4 integration
green (`c5814c4`). Then made customer-consumable (`af4419d`): a new `OperatorOrTenantGuard` lets the
one controller serve BOTH the staff/ops operator path (operator-supplied tenantId) AND the customer
dashboard's tenant-token path (ADR-0003 minted token → `req.tenant`; tenantId derived from the token,
NEVER the client). A present operator token must be valid (no silent fall-through); absent → the
ApiKeyGuard path runs. This sets the reuse pattern for W-B (keys/webhooks real-wiring). Controller +
guard unit specs (11) + full api integration suite (117) green; also fixed stale `api-key.guard.spec`
assertions predating the ADR-0004 `req.tenant` app/env fields.

**Phase 2/3 (dashboard Applications surface) — DONE (`e0f87e5`):** the FIRST customer-facing consumer
of the applications API. New `/applications` dashboard section (server component) lists the workspace's
apps with each one's environment status (sandbox active / live locked-until-go-live) + an owner/admin
create dialog (TanStack Form against `createApplicationRequestSchema`, slug auto-derived). Server-only
`applications-client` calls `/v1/applications` via `dashboardApi` (session-minted tenant token) and
parses the response against the contract; BFF POST route gates trusted-origin + session (refresh
fallback) + owner/admin. Added `applications:read` (universal — the switcher is a core surface) +
`applications:write` (owner/admin) to the role→permissions map so the BFF gate resolves; dev-login
stub matched. Verified: dashboard typecheck + production build green (`/applications` +
`/api/applications` compile), identity specs green (21). NOTHING pushed.

**Auth pivot — DONE (`4bf5a4c`), locked rule OVERRIDDEN per user directive.** SSO-only → **WorkOS
AuthKit hosted self-serve** (email+password + Google + passkeys, SSO optional; WorkOS hosts every
credential form, we own none). Customer realm self-serve; staff realm invite-only. CLAUDE.md §1+§4
rewritten. **Dev-login bypass DELETED** (shared `fe-auth/development.ts` + all 3 apps + dashboard
`/auth/development` route + bypass e2e + `DEV_AUTH_ENABLED`/`DEV_SESSION_PASSWORD`/`DEV_TENANT_ID`
env) — local sign-in now goes through the WorkOS Test env like every env. **`/login` no longer an
intermediate "click again" page** — 302s straight to the AuthKit hosted page (renders only for a
denial/sign-out banner); verified live (forwards to `…authkit.app`). Copy de-SSO'd → "Sign in" /
"Create an account". dev-portal edits were mandatory-only (it imported the deleted shared module) —
it's being deleted in W-B, don't invest.
- **Stripe-style LOOK is WorkOS-dashboard config (EXTERNAL — human):** enable Email+Password /
  Google / Passkeys, apply Fabric branding + one-screen layout, optional custom auth domain; confirm
  each `<APP>_BASE_URL/auth/callback` + `/login` redirect URIs.
- **"Access denied" after sign-in = self-serve signup gate OFF.** Now the **`platform.signup`
  kill-switch** (not an env flag) — fails closed, seeded OFF, toggled live from the admin console
  (`4bf5a4c`… converted in a later commit). A new WorkOS account isn't auto-provisioned a workspace
  until it's flipped on. Flipping it = **W-A**, testing-only; staging/prod human-gated redline (and
  gated on Phase-5 abuse controls existing first).

**W-B slice 1 — API keys real, under an application (`28e616f`).** First dev-portal→dashboard merge
slice. Keys were mock in the dev-portal; now real on the tenant-token API. Per ADR-0004 they live on
the **application-detail page** `/applications/[slug]`, split into **environment sections** (Sandbox
always; **Live hidden until go-live** unlocks it — a sandbox workspace never sees a live table).
`ApiKeysController` reuses `OperatorOrTenantGuard`; `ApiKeyService.create/list` gained an optional
`applicationId` (mint into the NAMED app's env, not just `default`; list filters by app). owner/admin
gained `api_keys:read/write`. Application cards link to the detail + show/count only ACTIVE envs.
Flat `/api-keys` page + nav item removed. **Fixed** a real bug: the tenant-token client set
`content-type: application/json` on every request, so a bodyless DELETE tripped Fastify's empty-JSON
parser → 400 and revoke silently failed; now set only when there's a body. **Browser-verified**
end-to-end (create → once-only secret; revoke → 200 → Revoked). **Key expiry/TTL added (`86bebae`,
migration 0048):** `api_keys.expires_at`; `resolve()` rejects expired keys (auth lookup gains
`expires_at IS NULL OR > now()`); create dialog Expires select (Never/30/60/90d) + table Expires
column. Integration-proven (future-expiry resolves; expired → null).

**W-B slice 2 — webhooks (`a84977b`):** real webhook endpoints under an application, per environment.
`WebhooksService.create/list` app/env-scoped; `WebhookEndpointDto` gains `env` (joined from
environments.type). App-detail page now uses **Tabs (API keys | Webhooks)** per active env, each a
standard Card-wrapped table; webhooks tab has Add-endpoint (url+description → once-only whsec_) +
delete. Fixed `apiRequest` to not parse a 204 body (webhook DELETE). Integration-proven (5/5).

**W-B slice 3 — request logs (`283232a` backend, `fae87df` UI):** net-new vertical (no prior backend).
`request_logs` table (migration 0049 + hand-written RLS 0050) — metadata only (never bodies/raw keys).
Global `RequestLogInterceptor` captures customer sk_* requests fire-and-forget + FAIL-OPEN (skips
bfft_ dashboard calls); `GET /v1/logs` keyset-paginated per app+env; daily retention @Cron in
MaintenanceService (default 30d, advisory-locked). owner/admin gain `request_logs:read`. Dashboard:
a third **Logs** tab per env section (colour-coded status, latency, request_id, time, "Load more").
Integration-proven (4/4: env-scoped keyset, record() fail-open, retention sweep).

**App-detail UX refinements (feedback-driven):** removed the per-page env switcher — the **topbar
Virtual/Live toggle is the ONE env selector** (env is workspace-wide: delivery mode + go-live are
per-workspace, no per-app exception), page follows `session.plan`. The **API keys tab** has its own
**Test/Live switch** (in the card header beside Create key, `ApiKeysPanel`) shown only post-go-live —
you manage both key sets independent of delivery mode. Application card footer shows the **API-key
count** (matches the table, incl. revoked) not the env count (`api_key_count` on ApplicationDto).
Dropped the sidebar "DASHBOARD" badge (ProductMark `showBadge`, dashboard-only). Standard empty
states + Card-wrapped tables throughout.

**dev-portal RETIRED (W-B final step).** Its developer surfaces are now real in the dashboard, so
`apps/dev-portal` is deleted along with its package.json scripts, pnpm-workspace entry, the CI
`deploy-dev-portal-testing` job, and all `infra/dev` Terraform (dev-portal.tf + the dev_portal
blocks in autoscaling/waf/monitoring/ecs/github-oidc/database/variables). `contracts/dev-portal.ts`
STAYS (the dashboard reuses its apiKey/webhook types — misnamed now, rename is a cosmetic follow-up).
No code imports the app; lockfile pruned; api/dashboard/admin typecheck green.
✅ **Live teardown DONE (human-approved "Full apply").** `terraform apply` in `infra/dev` destroyed
all 23 dev-portal resources (ECS service + task def + task role, service discovery, API-GW
api/integration/route/stage + its log group + 5xx alarm, autoscaling target/policies + alarms,
CloudFront edge, app log group, 2 secrets + versions) and dropped the dev-portal ARNs from 3 IAM
policies. The ECR repo refused the default delete (`RepositoryNotEmptyException` — held build
images); force-deleted via `aws ecr delete-repository --force`, then a second `terraform apply`
reconciled it out of state. Plan is now clean (`No changes`); 0 dev_portal resources in state. The
same apply also registered the drifted `app_env_backfill` E14 task def (harmless — task-def revision
only, runs nothing).
⚠️ **Remaining (external, not required):** remove the dev-portal `:3200` redirect URIs from the WorkOS
app (no WorkOS MCP tool this session — do it in the WorkOS dashboard, or ask me to browser-drive it).
They're now-unused entries, not a functional risk.

⚠️ **Local migration drift:** `__drizzle_migrations` tracks through 0046, but 0047–0050 are applied
to the local DB (0047/0048 out-of-band from prior sessions; 0049/0050 applied directly this session
because `drizzle-kit migrate` re-runs the untracked 0047 and errors). Migration FILES are correct +
journaled for a fresh CI/deploy migrate. To reconcile locally: `db:up` fresh + migrate, or record
0047–0050 into `__drizzle_migrations`.

⚠️ **Running API dev server was serving STALE code this session** (didn't hot-reload the api-keys
controller/service edits — a live create wrote NULL expiry despite correct, integration-proven code;
a direct BFF probe confirmed the request reached the API but the stale handler dropped it).
**Restart the API** (`dev:stack:infisical`) to pick up this session's api-keys backend (app-scoping +
expiry). Dashboard-side changes hot-reloaded fine (revoke fix verified live).

**Next — Phases 1–5** per `docs/PI-6/PLAN.md` (frontend-heavy): global environment SWITCHER (chrome
control that pins the selected app/env into subsequent calls — keys, sends; tied to task #9 moving
`delivery_mode` onto the environment); **W-B dev-portal→dashboard merge** — real-wire the still-MOCK
developer surfaces (`apps/dev-portal` keys/reference/webhooks/logs use `@/lib/mock-api`) as
`developer_access`-gated dashboard sections scoped per app-env; marketing app (separate); flip
the `platform.signup` kill-switch in testing (needs human go — redline); Node/Python SDKs; usage;
admin-console realignment. Email + AI are later PIs. Frontend verifies via build/browser, not the
integration-test discipline — different cadence. NB: a live browser drive of `/applications` needs the
full stack up (db + infisical api + dashboard + dev-seed); the tenant-token path itself is API-layer
integration-proven.

**Branch commits (E14):** `2301adc` ADR/plan · `337ae79` schema+RLS · `c537739` contracts ·
`16b081d` backfill · `c523157` key/webhook columns · `a58d2f4` key mint/resolve · `8f6b512` webhook
scope · `7451ed8` provisioning · `912cd03` env routing · `f30a65a` go-live env-unlock · `c5814c4`
applications API · `af4419d` applications API tenant-token path · `e0f87e5` dashboard Applications
surface + permissions · `4bf5a4c` remove dev-login bypass + login forwards to AuthKit (auth pivot) ·
`d68113e` self-serve gate → platform.signup kill-switch · `0400737` ApplicationCard restyle ·
`28e616f` API keys under an application per env (W-B slice 1) (+ HANDOFF/doc commits). Merge order
when done: E13→`dev` first, then this rebases (fifi merges).

_Milestone rule (user directive 2026-07-12): update this HANDOFF.md at every milestone._

## Where things stand

**All 4 apps are DEPLOYED and live in the AWS testing env** (account 677035504110 / eu-west-1),
OIDC→ECR→ECS Fargate behind API Gateway:

| App | URL |
|---|---|
| API | `https://jl4j64pxl3.execute-api.eu-west-1.amazonaws.com` |
| Dashboard (customer :3100) | `https://eq0ydft9pa.execute-api.eu-west-1.amazonaws.com` |
| Admin-console (staff :3300) | `https://leg9wvf1bb.execute-api.eu-west-1.amazonaws.com` |
| Dev-portal (developer :3200) | `https://ko1yjzer8b.execute-api.eu-west-1.amazonaws.com` |

`dev` HEAD ≈ `558e723`. `testing` promoted to it (migrations 0022–0026 applied). Deploy uses the
**`app-dev`** AWS CLI profile (the default profile has NO creds; on git-bash set `MSYS_NO_PATHCONV=1`
for `aws`/`gh` calls with `/`-paths). Seeded testing staff admin: `dacsolo10@gmail.com` (via a
`cloud-seed` ECS run-task).

## Architecture-review remediation (2026-07-09, PRs #96–#111, squash-merged to dev)

Worked an architecture + admin-console review to merged PRs, one finding per PR
(`team/product-owner/ARCHITECTURE-FIXES-PROMPT.md` is the tracking doc):

- **Money correctness:** scheduled reservation-sweeper + ledger-invariant job (#96); client
  `Idempotency-Key` on `POST /v1/sms/send`, no double-charge on retry (#97).
- **Data-plane hardening:** kill-switch TTL cache w/ last-known-good fallback (#98); pino
  structured logging + request-id (#99); token-bucket rate limiting per key + per tenant (#102).
- **Async spine (build-now):** BullMQ send pipeline — provider call + tx2 in an in-process worker,
  tx1 stays in-request, inline fallback (#100); **ElastiCache Redis applied to testing** +
  `REDIS_QUEUE_URL` on the api task-def (#101); transactional outbox + HMAC-signed tenant webhooks
  (#105); provider kill-switch wired to the send path + dead switches pruned (#107).
- **Admin console:** dropped `mock-admin` dead code + repointed at contracts + codified CLAUDE.md
  §3 standards (#106); trusted-origin CSRF gate on every BFF mutation route (#103); single-flight
  token refresh + typed failure semantics + dev-portal helper (#104); vitest bootstrap + first
  tests (#108); tenant detail route keys on slug (#109); **standardized keyset pagination across
  all control-plane tables** (#110); tenant lifecycle actions suspend/reinstate/soft-close (#111).
- **Docs:** ARCHITECTURE §4/§5/§10 + IDENTITY §12.5 (invite-only) / §3.3 (SLO) reconciled to
  as-built (this PR).

**Still open:** A1 full act-as impersonation (plan approved, not built — largest item);
back-channel SLO; MFA enforcement (env-gated); OTel tracing/metrics; admin-console
component/e2e tests. Redis infra is the one applied `terraform apply` (human-confirmed).

## Shipped in the prior session (PRs #71–#90, squash-merged to dev)

Auto top-up · Arkesel SMS adapter + DLR (sandbox) · full UI standardization (PageHeader, shadcn
date/time pickers, DataTable, Form kit, StatCard, chart skeletons, first-class states) · big-bang
TanStack (Query/Table/Form) migration across all 3 apps · real overview (no mocks) · Transactions/
Lighthouse flow slices 1–2 (persist + real Paystack collection via webhook) · SSO journey fix
(denied/signed-out flash-cookie banners, authed→home bounce) · admin+dev deploy plumbing (#87) ·
invite provisioning (#88: staff WorkOS onboarding + `developer` role) · member management (#89:
role-change / soft-remove / resend) · admin-console tenant-member management + dropped provisioning
mock (#90).

## In flight (branch `fix/ops-callback-base-url`, not yet merged)

Fixes the deployed admin/dev callback redirecting to `http://0.0.0.0:3000` after WorkOS auth (built
redirects from `request.url`, which behind API Gateway is the container's internal host). Now uses a
`redirectUrl()` helper resolving `<APP>_BASE_URL`. Also carries this `HANDOFF.md` + `CLAUDE.md`.
**Next:** PR → CI → squash-merge to dev → promote `dev`→`testing` (`git checkout testing; git merge
--no-ff origin/dev; git push`) → redeploy. Until then, deployed admin/dev login dead-ends on
`0.0.0.0:3000`.

## To log in to deployed admin/dev

Invite via the real flow (dashboard Team / admin-console Staff). Unprovisioned identities get the
now-explained `access_denied`. `dacsolo10@gmail.com` is already a testing staff admin → lands on the
Staff Console once the callback-base-url fix deploys.

## Next candidates

- Flows slice 3 (human-gated): real Verify provider + OTP delivery + live SMS notify.
- Staging/production deploy jobs for admin/dev (mirror dashboard) + staging/prod Terraform → flip
  gates (human go).
- Real auth provider off the WorkOS Test IdP (enable Google / email+password at the env level, or
  per-tenant SSO connections) — env-level toggle, no code.
- SMS live: Arkesel done + gated; needs sender-ID approval + funded wallet (human).

## Redlines — never cross without an explicit human go

`terraform apply`, deploy-gate flips, and live external writes need explicit confirmation. **Live
SMS** (Arkesel real) and **live payments** (Paystack live keys) stay OFF — sandbox `sk_test_` /
`SMS_PROVIDER=fake` only. No credentials into third parties. Print secret prefixes, never values.

_Deeper, always-current state also lives in the assistant's memory (`MEMORY.md` index →
`deploy-state`, `auth-provisioning-state`, etc.)._
