# Fabric — session handoff

_Snapshot: 2026-08-09. Point-in-time. **Verify against code and git before treating any of it as
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
| `origin/dev` | `7888330` | WhatsApp stack #259–#265, then #267–#271 |
| `origin/testing` | `af3f89e` | DEPLOYED 2026-08-09 (#266). **`dev` is now 5 commits AHEAD — not promoted.** |

**The WhatsApp channel is DEPLOYED to testing.** All six jobs green including
`Migrate · testing db`, which applied 14 migrations (`0136`–`0147`) and then ran `db:assert` on the
real database: *security layer applied ✓*, ledger + general-ledger invariants OK. That assertion
covering the two new tenant tables is what proves the RLS and the grant REVOKEs landed in a place
other than my laptop.

**What the deploy does NOT prove.** Live WhatsApp in testing needs a `meta-cloud` credential armed
THERE; the code travels, the credential does not. So testing has the channel and no way to send
until an operator arms it. `PLUGIN_MASTER_KEY` must exist in the testing environment or credential
resolution silently falls back to a derived development key.

Two process facts that cost real time and will again:

- **CI forbids stacked PRs** (`metadata` fails with *"Work branches must target dev"*), so each PR
  in a stack must be retargeted to `dev` as the one below it lands.
- **Squash-merging a stack destroys the merge base**, so every file the stack touched returns as an
  `add/add` conflict. The rule that made this checkable rather than a guess: for each conflicted
  path compare dev's blob to the blob at the commit the branch actually built on — equal means dev
  added nothing the branch lacks, so taking the branch's side is provably correct. Only the two
  files where dev had genuinely diverged needed reading.
- **`Deploy` reports success while skipping all its jobs** — it is the gated AWS/ECS path. The real
  one is `Deploy testing (Vercel + Render)`. Its green tick is not evidence anything shipped.

Nothing uncommitted. The testing deploy ran all six jobs green — gate, **`Migrate · testing db`
(0133 applied)**, Render api, and the three Vercel apps — and the pipeline verifies the artefact
itself, not just its own exit code: the api job polls `/health/readyz` on the live Render URL and
each frontend job checks `/healthz`.

**Two traps in reading that deploy.** The separate `Deploy` workflow reported **success while
skipping all eight of its jobs** — it is the AWS/ECS path and is gated off, so its green tick is not
evidence anything shipped. And a promotion PR title must be **Conventional Commits**: `promote: …`
is rejected by the PR-policy check (`chore(ops): promote …` passes).

**What the deploy did NOT prove.** The queue and rate limiter now run RESP3 (ioredis 6) against
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

### Landed after the deploy — five PRs, not yet promoted (#267–#271)

`testing` carries the WhatsApp channel as deployed; these five are on `dev` and **have not been
promoted**, so a promotion is the next deploy-shaped action. Two add migrations (`0148`, `0149`).

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
- **Inbound attribution cross-attributes on a shared WABA, by design** (ADR-0015 §2): two
  tenants messaging the same consumer inside one window, and the second one wins. Both are
  legitimate senders, so no rule available to us separates them — the fix is per-tenant numbers,
  a commercial/onboarding change. A test asserts the current behaviour, so read the ADR before
  treating a mis-delivered reply as a bug.
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

### Next up, in a fresh session

1. **Promote `dev` → `testing`.** Five merged PRs are unpromoted, including two migrations. Same shape
   as #266: a PR titled `chore(ops): promote …` (Conventional Commits — `promote: …` is rejected), a
   real MERGE not a squash, and watch **`Deploy testing (Vercel + Render)`** — the plain `Deploy`
   workflow reports success while skipping all its jobs because it is the gated AWS path.
2. **#23 — and the drift gate it silently disabled.** Diagnosed properly on 2026-08-10; the earlier
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
3. **#14 — `WORKOS_ADMIN_CLIENT_ID` / `WORKOS_ADMIN_API_KEY` in Vercel**, then remove the last dashboard
   redirect.

### Waiting on you, not on code

- **Rotate `WHATSAPP_ACCESS_TOKEN`** — it was printed in full in a session transcript on 2026-08-09.
- **Arm a `meta-cloud` credential in the testing environment** if WhatsApp should send from there. The
  code promotes; the credential does not travel with it.
- **`PLUGIN_MASTER_KEY` is now set in dev AND on Render (testing).** Production still needs one and does
  not warn — it REFUSES TO BOOT. One consequence to check rather than assume: setting the key CHANGES
  credential derivation, so any plugin instance in testing whose `credentials_ref` was sealed under the
  derived development key can no longer be opened. The symptom is `plugin resolution failed … failing
  closed` in the API log, and the remedy is re-arming (`scripts/rearm-whatsapp.ts` for meta-cloud). If
  nothing was ever armed in testing there is nothing to re-seal.
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
- `plugin_instances` has no tenant column and two specs delete the whole table. Their guard now
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

**The local DB has pre-existing data damage**: `token_counters` holds balances while `token_lots`,
`token_holds` and `ledger_entries` are all empty, so `db:assert` fails on reconciliation (the
security section passes). Cause undetermined — every spec's ledger delete is tenant-scoped and no
spec hardcodes the seed tenant. A reset would clear it, at the cost of the re-installed Arkesel
credential.

---

## Traps this repo keeps re-learning

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
