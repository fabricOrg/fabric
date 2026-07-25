# Fabric — session handoff

_Snapshot: 2026-07-25. Point-in-time; verify against code/git before asserting as fact. Companion to
[CLAUDE.md](./CLAUDE.md) (the how-we-build guide) and `docs/`._

## Latest (2026-07-25): ADR-0010 pricing build — Phase 1 slices 1+2 (branch `feature/ops-pricing-rate-books`, committed, NOT pushed)

Replaced the hardcoded rate constants with **staff-configurable price books** resolved per account,
and flattened email pricing to **flat per send**. Phase 1 slices 1+2 (money-correctness core); slice 3
(admin-console pricing UI + per-account assignment) deferred; Phase 2 (tokens) still gated on a
wallet/security review. **Zero price change on launch** — the seeded default book == old rates.

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
- **Next**: slice 3 (admin pricing UI + account assignment; the upsert/assign contracts already
  exist), then Phase 2 tokens (after the wallet/security review). **Redlines hold** — nothing pushed;
  `dev` advances only by squash-merge on a human go.

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
