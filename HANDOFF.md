# Fabric — session handoff

_Snapshot: 2026-08-12. Point-in-time. **Verify against code and git before treating any of it as
fact** — `git fetch && git log HEAD..origin/dev` first, always. Companion to
[CLAUDE.md](./CLAUDE.md) (how we build) and `docs/`. Superseded entries live in
[docs/HANDOFF-ARCHIVE.md](./docs/HANDOFF-ARCHIVE.md)._

> **Keep this file short.** It is a snapshot of the CURRENT state, not a log — it had grown to 2,800
> lines of append-only history, which every session then paid to read. When you finish a milestone,
> REPLACE the state below; move the old entry to the archive only if it carries reasoning a commit
> message would lose. Git already records what happened.

---

## Where things stand

| ref | sha | note |
| --- | --- | --- |
| `origin/dev` | `e0af752` | through #297 |
| `origin/testing` | `a80e7a4` | DEPLOYED 2026-08-12. **Level with `dev`.** 151 migrations, none added since. |

### Start here — one PR open, reviewed

**#298 — the WhatsApp price-book row.** One commit, based on `dev`. Independent review run.

Promotion is a **real merge** (`git merge --no-ff dev` — testing carries merge commits, and this
repo's git config is `ff = only`, so a plain `git merge dev` aborts with "Not possible to
fast-forward"). Watch `Deploy testing (Vercel + Render)`; the plain `Deploy` greens while skipping
every job.

Dependabot PRs #279–#282 and the old #200/#203/#214 are untouched and unrelated.

### WhatsApp pricing now works end to end (2026-08-12)

`#297` fixed a 500 that made any price book containing a WhatsApp rate unsaveable —
`pricing_sell_rules.unit_basis` was written by a two-way ternary over a three-member union, so
WhatsApp stored `'recipient'` and violated `pricing_sell_rules_basis_chk`.

**Verified in the testing DB, not by a 200:** book `WhatsApp Testing` (subscription, not default, not
published) holds `sms/segment/40`, `email/recipient/50`, `whatsapp/message/300` GHS. WhatsApp sells at
GHS 3.00 against the `testing whatsapp prcing` provider cost of GHS 2.00 — 33% margin, clear of the
2000bps floor.

**Three variants of ONE defect shape were found in a row: a total `Record` sitting beside a partial
literal over the same channel union.** The sell-rule writer (#297), the public calculator's
`isPublishedRate` (#297), and the pricing card's row list (#298). Each had a comment nearby claiming
totality that was true of the map and silently false of the literal. If you touch anything keyed by
channel, grep for the other half.

Still open, same family: `packages/sdk` types messages as `"sms" | "email"` only, and
`packages/cli/src/manifest.ts:60` has a two-channel zod enum.

### WhatsApp templates now sync in testing — RESOLVED

Measured 2026-08-12 23:00 UTC: **5 templates, 1 tenant, syncing hourly.** One tenant is correct, not a
shortfall — testing has 4 workspaces but exactly ONE active live environment (`fabric-local`); the
other three are `plan=sandbox` with `live | locked` and are meant to stay empty.

Three things had to be true at once, and each failed independently:

1. The sync could only discover tenants that already held a template row or had already sent a
   non-sandbox message — chicken-and-egg. An active live environment is now enough (#290).
2. `meta-cloud live` had to be armed in testing. Done by the project owner; `enabled=true`,
   `default=true`, `creds=true`. **Treat testing as live for WhatsApp.**
3. The hourly `@Cron` never fires, because Render's free tier sleeps the service and a sleeping
   process runs no cron. A GitHub Actions workflow now poking `POST
   /internal/admin/whatsapp/template-sync` hourly is what actually drives it — the request wakes the
   instance, which is the mechanism, not a workaround. **Temporary; see
   [docs/TEMPORARY-CI-CRON.md](./docs/TEMPORARY-CI-CRON.md) for the delete conditions.** It does NOT
   fix the queue worker, which needs a process alive when a job arrives.

If templates go stale, check that org secret `BFF_INTERNAL_TOKEN` still matches the value Render
holds — a rotation on one side fails the workflow with 401 and has no customer-visible symptom.

### What #288 shipped, and what was verified rather than assumed

Nine commits. Verified in the testing database, not from the deploy log:
`uniq_whatsapp_templates_tenant_waba_name_language` present, the waba-only index gone,
`idx_whatsapp_templates_waba` added, **151** migrations applied.

Audited testing before promoting, for the currency defect #287 fixes — **and that first audit was
VACUOUS**: it ran as `app_migrator`, which has no permissive RLS policy and no tenant context, so every
tenant table answered 0 because it was filtered, not because it was empty. Re-run as `app_provisioner`
the answer is genuinely **0** non-GHS accounts, **0** mismatched `payments`, **0** mismatched
`auto_topup`, **0** mismatched customer ledger accounts — so no backfill was needed and the conclusion
survives, by luck rather than by the check. Read §"Reading the testing database" below before trusting
any count from that environment.


**The WhatsApp channel is DEPLOYED to testing.** All six jobs green including
`Migrate · testing db`, which applied 14 migrations (`0136`–`0147`) and then ran `db:assert` on the
real database: *security layer applied ✓*, ledger + general-ledger invariants OK. That assertion
covering the two new tenant tables is what proves the RLS and the grant REVOKEs landed in a place
other than my laptop.

**What the deploy does NOT prove.** ~~Live WhatsApp in testing needs a `meta-cloud` credential armed
THERE~~ — armed 2026-08-12, see above. `PLUGIN_MASTER_KEY` must exist in the testing environment or credential
resolution silently falls back to a derived development key.

Two process facts that cost real time and will again:

- **CI forbids stacked PRs** (`metadata` fails with *"Work branches must target dev"*), so each PR
  in a stack must be retargeted to `dev` as the one below it lands.
- **Squash-merging a stack destroys the merge base**, so every file the stack touched returns as an
  `add/add` conflict. The rule that made this checkable rather than a guess: for each conflicted
  path compare dev's blob to the blob at the commit the branch actually built on — equal means dev
  added nothing the branch lacks, so taking the branch's side is provably correct. Only the two
  files where dev had genuinely diverged needed reading.
- **`Deploy` reports success while skipping all eight of its jobs** — it is the gated AWS/ECS path.
  The real one is `Deploy testing (Vercel + Render)`. Its green tick is not evidence anything
  shipped; read the job list. Confirmed again on #274.
- **A promotion PR title must be Conventional Commits** — `promote: …` is rejected by the PR-policy
  check, `chore(ops): promote …` passes — and the merge must be a **real merge, not a squash**.

The `Deploy testing` pipeline verifies the artefact rather than its own exit code: the api job polls
`/health/readyz` on the live Render URL and each frontend job checks `/healthz`.

**What the deploys did NOT prove.** The queue and rate limiter now run RESP3 (ioredis 6) against
testing's Redis, and nothing has exercised that — `readyz` does not touch them and no CI job ever
starts a Redis. A silent fall-through to the inline path looks identical to success from outside.
Settle it the way §9 says: a send whose `provider_ref` is a real vendor id, not `fake-…`, plus the
worker log line. Likewise the tenant kill-switch path is inert until an operator creates an override
— the deploy proves the migration, not the feature.

### Just shipped — the WhatsApp channel, VERIFIED LIVE END TO END (PR stack #261–#265)

Meta Cloud API as a first-class channel: adapter, persistence, money vocabulary, outbound send,
signed webhook ingress, template lifecycle, SDK resource, dashboard surface, managed sends
through `POST /v1/message-deliveries`, inbound + the service window, and costable offers.

**Proven against real Meta on 2026-08-09, not against a fake** — one round trip, both directions:

| step | evidence |
| --- | --- |
| outbound | `provider_ref = wamid.HBgMMjMzNTQ1MjI3MTg5…` — a vendor id, never `fake-…` (§9) |
| delivery | webhook returned through ngrok, message → `delivered` |
| settlement | ledger `pending → committed`, GHS 0.30, on the delivered transition |
| inbound | a real handset reply attributed to the right tenant with NO tenant in the payload |
| window | opened on the inbound, expires exactly +24h |
| event | `message.received` carrying a subject-id surrogate, no PII |
| vault | inbound body decrypts back out; `whatsapp_inbound_messages` has no plaintext column |

Two earlier fixes were confirmed by real failures rather than by tests: an expired Meta token
produced a `failed` send that was correctly REFUNDED (reserve `pending` → `refunded`, customer not
charged) — the exact defect that once charged for a message that never left; and watching a
successful send exposed a stranded-reserve bug in the dispatch claim (see 0147 below).

**The idea to carry forward: WhatsApp content is not ours.** It lives in a Meta-approved
template, so a WhatsApp definition holds a BINDING, not a body, and `parameters` is an ORDERED
list of variable names — Meta body params are positional and carry no names on the wire, so
reordering that array silently changes which value lands where. It is content, not config.

That relocates the security question rather than removing it. Nothing is interpolated into
authored markup, so no escaping is required; the surface is Meta's parameter grammar, and a
parameter with a newline, a tab, 5+ consecutive spaces or over 1024 chars is rejected by Meta
AFTER the reserve and after the delivery row exists. The pure core blocks it pre-acceptance.

Locale also means something different: Meta stores one template per name+language, so "the
French version" IS a different template row. An override carries a `template_language`, not
text, and an unsupported locale BLOCKS rather than quietly sending the default language.

Pricing is flat per template message (ADR-0014 §3), superseding ADR-0012's conversation guess.
Meta bills per 24-hour conversation, but a conversation's boundary depends on the customer's
replies — nothing a caller can price against before sending. We sell one priced message.

**Three latent defects, all the same shape: a two-channel ternary that mis-files a third.**
`PricingService` filed every non-email rate row under SMS (a WhatsApp rate would have repriced
every text message on that account); `persistManagedAcceptance` and the managed delivery read
would have written/read attempt rows claiming the wrong message. Plus
`price_book_rates_channel_chk` still admitted only `sms|email` while its two sibling tables
already listed `whatsapp` — the seed broke the moment WhatsApp got a compiled rate, and the
admin price-book form would have 500'd on the first WhatsApp rate saved.

**Template state is a CACHE with a stated posture**, not a fact: a fresh negative blocks before
money moves; an absent or stale row fails OPEN so our sync lag is not a channel outage.

### Closed from the grant sweep — `audit_events` is now actually append-only

The provisioner narrowing on `audit_events` (SELECT+INSERT, no UPDATE/DELETE) previously **recorded
intent without enforcing it**, because `prepareRoles()` (`src/cloud-migrate.ts:123`) re-grants
`app_provisioner` full DML on ALL TABLES every deploy. `cloud-migrate-privileges.ts` now re-asserts
the REVOKE after migrations — the mechanism the GL tables already used — and
`security-layer.check.ts` §8b asks Postgres via `has_table_privilege` whether the re-assertion
actually ran. The check asserts **both** directions: no UPDATE/DELETE/TRUNCATE, and INSERT still
held, because a too-aggressive REVOKE would leave a trail nothing can write and look identical to
success from the other assertion alone.

**Find grant holes by asking Postgres, never by reading comments** — `has_table_privilege`, not
prose. Four of the six tables #250 fixed carried a comment asserting protection that did not exist,
and two cited a SIBLING as the reason they were safe while that sibling was itself a hole.

---

## Read this before touching sends

**There is no "go live" step, and any non-sandbox workspace is already live.**
`virtual-phone.service.ts:60` makes live the default; virtual is opt-IN. Go-live gates the transition
OUT of the `sandbox` plan, so a workspace seeded straight onto a paid plan starts on the far side of
it. `Fabric Local` is `plan = growth` with `settings = {}` → live.

Combined with an armed live provider instance, that means **real carrier, real money**, including
from `pnpm test:integration`. Two incidents came from this:

- The integration suite reached a live vendor. Fixed — the spec pins its own provider.
- The integration suite **destroyed** the armed Arkesel live credential via an unqualified
  `delete(pluginInstances)`. Unrecoverable; re-installed by hand. Guarded since by
  `assertDisposablePluginCatalog()`.

Consider seeding local/testing workspaces as `plan = 'sandbox'` (forced virtual, `locked: true`) and
flipping deliberately. Seed change only, no product code.

**Live sends read `accepted` → `expired` even when they arrive**, because the Arkesel DLR callback is
not configured. Money and credits are unaffected; only status. Route is
`/webhooks/dlr/arkesel-sms`, guarded by `WEBHOOK_INGRESS_TOKEN` (header `x-webhook-token` or
`?token=`, since Arkesel GETs with `?sms_id=..&status=..`).

---

### Promoted 2026-08-10 (#274) — the evidence-table revokes and the SMS dispatch claim

`testing` now carries everything `dev` does. All six jobs green, including `Migrate · testing db`,
which applied `0148`–`0149` and ran `db:assert` on the real database (*security layer applied ✓*,
ledger + general-ledger invariants OK). Two of the seven PRs added migrations.

**#271 — `app_runtime` could DELETE the billing evidence for a charge.** `0001` grants full DML on ALL
TABLES plus `ALTER DEFAULT PRIVILEGES`, so DELETE is present until a migration takes it away, and a
GRANT cannot narrow anything — `GRANT SELECT, INSERT, UPDATE` in `0063` reads like a restriction and is
not one. Only the WhatsApp pair had been closed. A message row is the ledger's `reference_id` target, so
deleting one orphans a COMMITTED wallet transaction. Now revoked on seven tables, with `§8d` asserting
BOTH directions (the revoke landed AND the writes survived) plus that the provisioner KEEPS delete for
retention.

**#269 — the SMS double-send.** `loadStoredDispatch` was a plain SELECT, so the first database lock
landed AFTER the carrier call: two workers on one Redis queue both sent. Now an atomic claim with a
5-minute lease (`0148` adds `leased_at`). Deliberately no status CHECK, unlike `0147` — a new
constraint would validate against production rows the migration cannot inspect.

**#268 — WhatsApp template picker, and a bug behind it.** `template_category` never reaches Meta; it
selects OUR message class, and `marketing` → `promotional` is gated twice (consent suppression AND a
delivery-window rule). A free-text form let a caller skip both and bill the wrong class. Now derived in
the UI and REJECTED server-side on mismatch.

**#270 — three isolation specs ran `DELETE FROM accounts` with no WHERE.** A WhatsApp foreign key is the
only reason the pilot tenant survived one run. Guarded in BOTH hooks, skipped under `CI`.

### Two lessons worth keeping

- **`verify:push` runs unit tests; CI also runs integration.** No amount of local pushing surfaces a
  stale integration spec. Three broke this session (kill-switch prune, two db channel specs) — all in
  directories the diff did not touch. Run the integration directories your change could REACH, not the
  ones it edits.
- **A stale `.next` fails typecheck after a branch switch.** Cost three gate failures. `rm -rf
  apps/*/.next` before a push when branches differ in routes or pages.

## Open work

### WhatsApp — what is NOT built

The channel is otherwise complete: direct sends, webhook ingress, template lifecycle, SDK,
dashboard, managed sends, inbound + the service window, and costable offers.

- **Free-form sends inside the service window.** ADR-0015 §6: the window makes them legal, it
  does not make them PRICED. A free-form reply is a *service conversation* in Meta's billing.
  Phase 4 gave that sell rate somewhere to live; nobody has set one, and serving a send we
  cannot cost is what ADR-0012's costability rule forbids. This is the last WhatsApp gap.
- **Inbound attribution cross-attributes on a shared WABA** (ADR-0015 §2): two tenants messaging
  the same consumer inside one window, and the second one wins. A test asserts the current
  behaviour, so read the ADR before treating a mis-delivered reply as a bug. **ADR-0016 now
  decides the fix** — per-tenant WABAs via Embedded Signup — so this is scheduled, not accepted.
- **Customers cannot create templates, and the UI tells them to do the impossible.** The adapter
  has `listTemplates` (GET) and no create call
  (`packages/integrations/src/meta-cloud/provider.ts:145`); the empty state says "create one in
  Meta Business Manager", which is OUR Business Manager and they have no access to it. Fix the
  copy now; ADR-0016 fixes the cause.
- ~~`whatsapp_dispatches` leaves `status='sending'`~~ — fixed (0147). Worth knowing WHY it
  mattered: the mislabelling was cosmetic, but it hid that a dispatch whose worker died holding
  the claim was invisible to the sweeper forever, with its wallet reserve neither committed nor
  refunded. `leased_at` had existed unread since the claim was added. SMS has no claim step, so
  the same sweeper query is correct there — WhatsApp inherited the query without the assumption.

- The preview route gates on the `sms:read` scope for EVERY channel. Pre-existing, applies to
  email too; renaming a scope is a separate breaking change.
- **The drizzle snapshot chain is broken from 0135 onward** (0135/0136 share an id, 0137–0144
  have no snapshots), so `drizzle-kit generate` errors and every migration since is
  hand-written. Journal entries are appended by hand. Repair this before the next schema change
  that would benefit from generation.

### Verified against the deployed testing database (2026-08-10)

**The Neon CLI is available and authenticated — use it. Testing is inspectable, so stop inferring what
you can measure.** `neondb` is owned by **`app_migrator`**, which mirrors production, and that matters:
`ALTER DEFAULT PRIVILEGES` is grantor-scoped, so an `app_owner`-owned local database HIDES grant holes
that testing shows plainly.

### Reading the testing database — WHICH ROLE decides what you see

**Read tenant tables as `app_provisioner`. `app_migrator` silently returns ZERO ROWS from every one of
them** — it holds no permissive RLS policy and carries no `app.tenant_id`, so FORCE RLS filters the
result to nothing and a count of 0 is indistinguishable from an empty table. This produced a false
"testing has no workspaces" reading and a vacuous currency audit on 2026-08-12; testing actually holds
4 accounts, 7 users, 9 memberships, 4 applications and 8 environments.

Platform tables (`staff_users`, `plugin_instances`) have no RLS and read correctly as either role,
which is exactly what makes the mistake convincing: some counts look right while the tenant ones are
silently empty.

Use `app_migrator` only for schema questions — `has_table_privilege`, `pg_indexes`,
`information_schema`, `drizzle.__drizzle_migrations`.

```bash
# The org prompt is interactive — always pass --org-id or it hangs.
neonctl projects list --org-id org-fragrant-meadow-35967446
# project fabric = dry-recipe-09519949 · single branch `production` = br-lively-frog-avkxhbz6 · db neondb

# TENANT data (accounts, users, memberships, environments, whatsapp_*, payments, ledger_*)
TESTING_PROV_URL=$(neonctl connection-string production --project-id dry-recipe-09519949 --org-id org-fragrant-meadow-35967446 --role-name app_provisioner --database-name neondb)
# SCHEMA and grants only
TESTING_DATABASE_URL=$(neonctl connection-string production --project-id dry-recipe-09519949 --org-id org-fragrant-meadow-35967446 --role-name app_migrator --database-name neondb)
```

Capture it into a variable and never echo it — it carries the password. Roles available:
`app_runtime`, `app_provisioner`, `app_migrator`, `neondb_owner`. Read-only queries only unless a human
has said otherwise.

What that measurement established, before and after the promotion:

- **The `app_runtime` DELETE hole was real — 7/7 evidence tables reported `delete=true`** (`messages`,
  `email_messages`, both dispatch tables, both managed-delivery tables, `outbox_events`) — and is now
  **CLOSED, measured after #274 rather than inferred from the green deploy**: all seven read
  `DELETE=false, TRUNCATE=false` with `INSERT`/`UPDATE` still `true`, and `app_provisioner` still holds
  DELETE on all seven so retention pruning survives. Testing is at **150** applied migrations, level
  with local. `leased_at` and `idx_message_dispatches_stale_lease` (`0148`) both present.
- **Exposure was prospective, not retrospective.** `messages`, `email_messages`, `whatsapp_messages` and
  `ledger_transactions` all held **0 rows** in testing, so nothing was destroyed while the hole was open.
- **The WhatsApp promotion fully landed**: all six tables present, including `0145`'s inbound pair
  (`whatsapp_inbound_messages`, `whatsapp_service_windows`, `whatsapp_unattributed_inbound`).
- **The `Deploy` workflow again reported success while skipping every job** — the gated AWS/ECS path.
  The real one is `Deploy testing (Vercel + Render)`. Read the job list, never the run's conclusion.

### Next up, in a fresh session

**Three deferred fixes, all from reviews that found them but were not acted on in-session.**

1. **A permanently-skipping auto-top-up is invisible.** `chargeableCurrency` returns null and writes
   `logger.error`; `getAutoTopup` still reports `enabled: true`, so the wallet renders a green "On"
   badge with a stale currency and no admin-console surface exists for `auto_topup` at all. The first
   customer-visible symptom is failed sends. Needs a field on `AutoTopupResponse` plus a warning
   state — a money guard whose only signal is a log line is not shipped.
2. **The currency selects should not offer what the server refuses.** `top-up-dialog.tsx` and
   `auto-topup-dialog.tsx` list every currency; the API now rejects a mismatch with
   `billing_currency_mismatch`, so the UX is "pick USD, get refused". Constraining the list needs
   `billing_currency` on a customer-facing endpoint — today it exists only in admin contracts.
3. **#287 merged without a fourth review.** It changed substantially after its third (the cron
   restructure that stopped the currency rule abandoning the whole tick). Deliberate call, recorded
   here rather than lost.

**Carried from the #290 review, unfixed and worth doing before customer onboarding:**

- **`tenantsForWaba`'s live-environment arm is deliberately UNSCOPED by WABA**, because `environments`
  carries no `waba_id` — no more than `whatsapp_messages` did. Correct only while ONE shared WABA
  exists. The day ADR-0016's per-tenant WABAs land, this hands WABA-B's template events to WABA-A's
  tenants and writes the wrong catalog. It is commented as such in `whatsapp-waba-tenants.ts`; it
  cannot ship past that point unchanged.
- **The scheduler fetches the same shared Meta catalog once PER TENANT**, inside one transaction
  holding an advisory lock, and the tenant set now scales with total live customers rather than
  WhatsApp adoption. Fetch once, then upsert per tenant, and move the HTTP work outside the
  transaction.
- **The template-webhook fan-out is O(all live tenants), serially, inside a request Meta retries on
  timeout.** Replace the loop with one set-based `UPDATE … WHERE tenant_id = ANY(...)`.

**Carried from the UI reviews, unfixed:** BFF role refusals emit `{ error: { message } }` with no
`type`/`code`, so envelope parsing fails and a `member` clicking Live gets "Something went wrong"
instead of the real reason; the senders page renders a failed load as an EMPTY state with no retry;
the sender row action sits off-screen on mobile at seven columns.



1. **Promote `dev` → `testing`.** `dev` is 2 ahead, one commit carrying `0150`. Same shape as #274:
   `chore(ops): promote …`, a REAL merge not a squash, and watch `Deploy testing (Vercel + Render)`.
2. **ADR-0016 Phase 1 — become a Tech Provider**, which is the prerequisite for the Solution Partner
   tier and for Embedded Signup either way. The checklist and the measured state of Meta app
   `1022581630670557` live in the ADR. None of it is code; all of it is account admin.
3. **#23 — and the drift gate it silently disabled.** Diagnosed properly on 2026-08-10; the earlier
   description in this file was wrong in both halves.

   - The journal has **NO duplicate idx** (150 entries, contiguous). The union scripts used during the
     stack merges keyed by tag and re-derived ordering, which repaired that half as a side effect.
   - The real failure is a **snapshot `prevId` collision**: `drizzle-kit generate` refuses with
     *"[0135_snapshot.json, 0136_snapshot.json] are pointing to a parent snapshot … which is a
     collision"*. Snapshots stop at `0136` while migrations run to `0149`.
   - **Fix the gate FIRST, it is the more serious half.** `assert-drift.mjs:75` swallows a generate
     failure — `} catch { /* a non-zero generate … is fine */ }` — and then concludes "no drift" because
     no files changed. Generate currently errors and writes nothing, so **the gate has been reporting
     success unconditionally**. It cannot tell "schema matches" from "generate is broken", and
     `drizzle-kit` exits **0** on this error, so an exit-code check would not save it either. Every "no
     drift" result since the collision appeared is unproven.
   - Only then repair the chain, and re-run generate to confirm it actually emits nothing.
4. **#14 — `WORKOS_ADMIN_CLIENT_ID` / `WORKOS_ADMIN_API_KEY` in Vercel**, then remove the last dashboard
   redirect.

### Waiting on you, not on code

- **Open the Meta partner-manager conversation (ADR-0016).** Whether Solution Partner applications are
  open to us, in our region, and on what commitment. Meta publishes nothing beyond "a lengthy process";
  it is the long pole and the only input that decides Solution Partner vs the multi-partner fallback.
  Start it in PARALLEL with Phase 1, not after.
- ~~Rotate `WHATSAPP_ACCESS_TOKEN`~~ — done 2026-08-10. **Re-arm is still outstanding**: the token is
  sealed INSIDE the `meta-cloud` credential (`rearm-whatsapp.ts:58`), so rotating it in Infisical does
  not update the sealed blob and the runtime still resolves the OLD token. Run
  `infisical run --env=dev -- pnpm --filter @app/api exec tsx scripts/rearm-whatsapp.ts`.
- **Arm a `meta-cloud` credential in the testing environment** if WhatsApp should send from there. The
  code promotes; the credential does not travel with it.
- **`PLUGIN_MASTER_KEY` is set in dev AND on Render (testing); it BROKE two credentials there.** Measured
  against the testing database on 2026-08-10, not guessed: `sms/arkesel (live)` (sealed 2026-07-29
  15:41) and `payment/paystack (live)` (15:44) were both sealed 12 days BEFORE the key existed, so both
  were sealed under the derived development key and the new key cannot open them. Symptom is
  `plugin resolution failed … failing closed`; both are still `enabled=true`.

  The direction is fail-safe — live SMS and live payments in testing now refuse rather than fire, which
  is where §7 says they should be — but the failure is opaque to anyone who tries. **DECISION PENDING:**
  re-arm both under the new key, or disable/revoke them so the state matches the redline. Disabling is
  the safer reading, since neither should be live in testing and re-arming re-creates that.

  Separately worth knowing on its own: **`sms/arkesel (live)` has been armed AND enabled in testing
  since 2026-07-29**, which predates this work and sits against §7's "live SMS stays OFF until a human
  flips it per engagement".

  Production still needs a key of its own and does not warn — it REFUSES TO BOOT.
- **A service-conversation sell rate**, if free-form WhatsApp replies inside the 24-hour window should
  work. The window makes them legal; nothing prices them, and ADR-0012 forbids serving a send we cannot
  cost.

**`verify.integration.spec.ts` is FLAKY — one CI failure, cause NOT pinned.** Failed once on #253
(`expected 400 to be 201` at :216, the "rejects an expired code" test), passed on re-run. Ruled out:
the Redis bump (CI starts no Redis, so neither package is active there, and the same suite passed on
#252 with ioredis 5) and the spec itself (6/6 in isolation locally, green in a local full-suite run).

The CI log narrows it: the failing `POST /v1/verify` returned a **234-byte** 400 in **41 ms**. The
file's intentional throttle 400 is 211 bytes in 5 ms — `verify_resend_throttled`, whose envelope
computes to exactly 211 — so this is a different error, and 41 ms means it reached the send pipeline
rather than stopping at the throttle pre-check. `sms_sending_paused` (159) and `recipient_opted_out`
(194) don't match the length either.

**It could not be diagnosed further because the spec asserted `statusCode` only** — a failure yielded
`400 ≠ 201` with no `error.code`, and the API does not log 4xx bodies. **Now fixed:** every status
assertion in that spec goes through an `expectStatus` helper that asserts an object, so a mismatch
carries the response body into the failure diff. The flake itself is still unpinned — this does not
fix it, it makes the next occurrence diagnosable instead of opaque.

While in that file: its masking assertion was **dead**. It searched the masked recipient for
`"227189"`, a fragment of the removed pinned pilot number that no longer appears anywhere in the
spec, so it could never match and proved nothing. It now asserts the exact expected mask
(`maskMsisdn` keeps the first 6 chars and last 4).

Also open: #251, #214, #203 (typescript 7), #200.

**Standards audit — safety net only.** Route error boundaries and shared `RouteError`/`RouteLoading`
landed. Still open: ~25 missing `loading.tsx`; nine separate `StatusBadge` implementations; ~30 ad-hoc
date formats.

**The "five empty-vs-error conflations" claim was WRONG and is retired.** An earlier revision of this
file listed `dashboard/senders:121`, `dashboard/templates:236`, `admin-console/senders:40`,
`admin-console/maker-checker:53` and `tenants/[slug]:182` as places a fetch failure renders as "you
have nothing". Read individually, **four of the five already branch on the error with distinct copy**,
and the two dashboard pages set `failed` AND `[]` in the same `.catch` with only one fetch on mount,
so the error branch always wins — the stale-data case the claim implied cannot occur. The list was
evidently produced by grepping for `length === 0` rather than by reading the files. Exactly one real
defect existed, and it was four lines from where the claim pointed: `maker-checker` caught the
**tenant-list** failure into `tenants = []`, so `NewProposalDialog` rendered an openable-but-empty
select and the operator could not file a proposal or learn why. Fixed by passing `tenantsFailed`
through, which lets the dialog separate "no tenants exist" from "we don't know".

Genuinely still open on this theme, and much narrower than the retired claim: **no page offers a
retry affordance** — every error state says "try again shortly" without a button — and
`tenants/[slug]:182` styles its error with the same `text-muted-foreground` as its empty state, so
the two read alike even though the copy differs. `Card` now draws blueprint corner marks
app-wide — anything inside `overflow-hidden` or a grid tighter than `gap-6` needs `corners={false}`.

---

### WhatsApp live-test operations

Two scripts exist because this recovery had to be done by hand once. Both run under Infisical and
neither prints a secret:

```
infisical run --env=dev -- pnpm --filter @app/api exec tsx scripts/rearm-whatsapp.ts
infisical run --env=dev -- pnpm --filter @app/api exec tsx scripts/live-whatsapp-send.ts +233XXXXXXXXX
```

- The WABA is Meta's **test number** (`+1 555-630-9347`, verified_name "Test Number"), so it can
  only message pre-registered recipients. Approved templates: `hello_world` plus four
  `jaspers_market_*` samples — all `en_US`.
- **The Meta access token is the recurring failure**, not the code. It has expired mid-work three
  times. `WHATSAPP_ACCESS_TOKEN` lives in Infisical **dev only**; a System User token with
  expiration "Never" is the fix. Diagnose with a Graph GET: 401/190/463 is expiry, and 400/100/33
  means the id or bearer is empty (usually the wrong Infisical environment).
- `PLUGIN_MASTER_KEY` is now set in dev. It matters more than it looks: without it credentials are
  sealed with a derived development key, and **re-sealing is required after it changes** — the old
  ciphertext will not open. Still ABSENT in staging and prod, where production does not warn, it
  REFUSES TO BOOT.
- `plugin_instances` **does** have a nullable `tenant_id` (`schema/integrations.ts:41-51`, added for
  ADR-0011 §2 so a customer can bring their own account without a migration) — an earlier revision of
  this file said it had none, and that claim is retired. What is true is that the RESOLVER ignores it:
  `plugin-resolver.service.ts:222` filters `isNull(tenantId)` on purpose, so per-tenant credentials are
  expressible but not yet resolved. That is the seam ADR-0016 builds on. Two specs still delete the
  whole table. Their guard now
  covers teardown as well as setup, but the rule stands: never point `DATABASE_URL_SUPER` at a
  database holding armed credentials while running the full integration suite.

## Local environment

Postgres and both Redis containers run under `channel-packages-*`. **Port 5432 is contested** — a
different project's `lesson2_postgres` held it, which surfaces as `password authentication failed for
user "app_owner"` rather than anything obviously about the wrong container. Check `docker ps` first.

**"The Redis containers are running" is not "Redis is reachable."** Both were up with NO published
host ports (`docker ps` showed a bare `6379/tcp`, `docker port` returned nothing), so every host
process silently took the no-Redis path. `docker compose up -d redis-queue redis-cache` recreates
them with the compose port mappings (6379, 6380). Check `docker port <container>`, not `docker ps`.

`drizzle.config.ts` reads `process.env` with no dotenv loading, so `pnpm db:migrate` needs the env in
process. Each worktree needs its own gitignored `.env`.

**`pnpm db:migrate` FAILS locally, and the schema is fine anyway.** The drizzle-kit CLI decides what to
apply by file HASH, and 8 migration files no longer match what was applied (7 edited after the fact,
plus `0075_thick_raider` which was never applied at all), so it tries to re-run them and dies with no
message. The PROGRAMMATIC migrator — the one `cloud-migrate.ts` uses on every deploy — is
timestamp-based and runs clean. Verify schema state by asking Postgres (`has_table_privilege`,
`information_schema`), never by the migration count. Related to #23 but a distinct failure.

**Local sign-in works only for an email the seed gave a MEMBERSHIP.** The dashboard forwards a staff
user holding no membership to the admin console (`app/auth/callback/route.ts:39`), which reads exactly
like a broken config. `SEED_OWNER_EMAIL` is a comma-separated list defaulting to every seeded staff
email; add any other identity you sign in with. The seed also refuses to run against a non-local
`DATABASE_URL_SUPER` — it writes across tenants as the superuser.

**`fabric-local` went LIVE on 2026-08-10** via the go-live maker-checker flow (audit: `tenant.go_live`).
`plan = sandbox` is the ONLY forced-virtual state (`virtual-phone.service.ts:51-68`); everything else
defaults to live. With `whatsapp | meta-cloud | live` armed and default, a WhatsApp send from this
workspace targets REAL Meta — only the stale pre-rotation token currently prevents delivery, which is
luck, not a control. SMS is safe: no live SMS instance is armed.

**The local DB has pre-existing data damage**: `token_counters` holds balances while `token_lots`,
`token_holds` and `ledger_entries` are all empty, so `db:assert` fails on reconciliation (the
security section passes). Cause undetermined — every spec's ledger delete is tenant-scoped and no
spec hardcodes the seed tenant. A reset would clear it, at the cost of the re-installed Arkesel
credential.

---

## Traps this repo keeps re-learning

- **A total `Record` beside a partial literal over the same union is this codebase's most repeated
  bug.** Three instances in one afternoon: the sell-rule writer, the public calculator's channel
  guard, and the pricing card's row list — each with a comment nearby claiming totality that held for
  the map and not for the literal. Adding a channel means grepping for BOTH halves.

- **A backgrounded `git push` reports exit 0 while the push failed.** The wrapper's status is not the
  gate's. `verify:push` failed on a Biome config error and the notification still said "completed
  (exit code 0)"; the only reliable check is `git ls-remote --heads origin <branch>` against
  `git rev-parse HEAD`. Same rule as the "never pipe a command whose exit code matters" rule.

- **A git worktree checked out INSIDE the repo wedges `biome check .` for everyone.** Its own
  `biome.jsonc` is a "nested root configuration", which is a hard error — Biome lints nothing and
  every pre-push in the main checkout fails with nothing wrong in the diff. `.codex-temp/` is now
  excluded; a worktree anywhere else under the repo root will do it again. Check
  `git worktree list` before believing a lint failure that names no file of yours.

- **`git merge dev` on `testing` aborts** with "Not possible to fast-forward" — this repo's config is
  `ff = only` and testing carries merge commits. Promotion needs `git merge --no-ff dev`.

Added 2026-08-12, all paid for in this session:

- **A count of 0 from a tenant table may mean "RLS filtered it", not "it is empty".** Reading testing
  as `app_migrator` returned 0 accounts, 0 users, 0 environments — all wrong; the same queries as
  `app_provisioner` returned 4, 7 and 8. It was convincing because the platform tables in the same
  query (`staff_users`, `plugin_instances`) answered correctly. A currency audit run that way was
  presented as evidence in a PR body and in this file before anyone noticed.

- **A spec that drives a scheduler UNFILTERED writes to every tenant in the database it points at.**
  `scheduler.run()` with no `tenantIds` loops whatever the discovery query returns and wrote the test
  double's fake catalog (`waba_id 987654321`) into `fabric-live-pilot` — the workspace holding the real
  WABA — where `afterAll` never cleaned it. It was reachable in the product: the compose picker does
  not filter by `waba_id`, so it would have offered a template that does not exist in that workspace's
  real WABA, reserving wallet money for a send Meta rejects. Assert the query, not the orchestrator.
- **Each fix in a chain can introduce the next defect.** Five review rounds on the wallet/payments
  files, and in four of them the defect under review had been created by the previous fix. A green
  pipeline says nothing about this; only an independent read does.
- **Size of diff is not blast radius.** A twenty-line "dev seed" granted owner memberships and rewrote
  go-live plan state; a one-line copy change described a money gate. Both were merged unreviewed
  before the gate in §5 existed.
- **Guard the side effect, not the pass through it.** A currency check placed at the top of the
  auto-top-up tick also skipped the dropped-webhook reconciler, so a card already debited would never
  have been credited — strictly worse than the mismatch being guarded.
- **Do not switch branches while a review subagent is running.** It reads the working tree; the review
  then describes code that is not on the branch under review.
- **`verify:push` gates the working tree, so a stale `.next` fails a two-markdown-file diff.**
  `rm -rf apps/*/.next` after branch-hopping.



Durable ones live in [CLAUDE.md](./CLAUDE.md) §9. These are recent and not yet promoted:

- **`tsc` cannot see a client/server boundary error.** Exporting a parser from a `"use client"`
  module made every export a client reference; the server component calling it threw at request time
  with perfectly valid types.
- **Green typecheck + a passing DB script is not a tested change.** A service rewrite shipped with
  three failing unit tests because the specs were never run — and the broken mock meant the rewritten
  method was never executed by any test at all.
- **Unlayered CSS beats every Tailwind utility** regardless of specificity. Custom classes need
  `@layer components` or per-call-site overrides silently do nothing.
- **`git cherry` is useless against a squash-merge workflow** — it is patch-id based and reports
  every commit as unmerged. Use a two-dot `git diff` to ask whether content actually landed.
- Windows: bash writes `/tmp/x`, node reads `D:\tmp\x`. Use an absolute scratchpad path. Heredocs
  also mangle backticks inside doc comments — use the Edit tool.
- **CI DOES run the integration suite.** An earlier revision of this file claimed
  "`integration:gate` is not wired into CI", and that claim was repeated into #253's commit message
  before being checked. `ci.yml` runs `pnpm verify:full`, which includes `test:integration`. What is
  actually true is narrower and still important: CI starts **Postgres but NOT Redis**, so
  Redis-dependent specs take their disabled/inline path there and a queue or limiter regression can
  still reach `dev` green. Verify a claim about the pipeline against `.github/workflows/`, not
  against this file.
- **A subset of specs is not the suite.** The Redis bump was validated locally against the 15 specs
  found by grepping `REDIS_QUEUE_URL` — a defensible subset that still missed `verify.integration`,
  which is what CI failed on. Grep-chosen scope answers "what mentions this", not "what this breaks".
- **A literal control character in source makes git treat the file as BINARY.** A NUL used as a cache
  key separator produced `Bin 0 -> 2498 bytes` in the diff: invisible in review, unmergeable on
  conflict, and the comment explaining it was unreadable. Write `\u0000`, never the raw byte. Caught
  in review, not by tests — every gate passed.
- **A stale checkout against a migrated DB fails in a way that looks like a code defect.** Running the
  pre-0133 kill-switch service against a DB that already had 0133 applied broke all three kill-switch
  specs (`ON CONFLICT (key)` no longer matches a constraint once the composite unique replaces it).
  Check which commit is checked out before believing a local integration failure.
