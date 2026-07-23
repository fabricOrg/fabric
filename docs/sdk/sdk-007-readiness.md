# SDK-007 readiness & decomposition — send managed Email in sandbox

> Status: readiness draft — 2026-07-21. Precedes implementation. Companion to the
> [SDK backlog](./managed-messaging-sdk-backlog.md#sdk-007---send-managed-email-in-sandbox),
> [ADR-0005](../decisions/0005-managed-messaging-sdk-resource-model.md) (resource model),
> [SDK-004 evidence](./evidence/sdk-004.md) (the inherited AC02 channel clause), and the
> [architecture plan](./managed-messaging-architecture-plan.md).
>
> Reuse map that this doc is built on: `scratchpad/reuse-map-report.md` (independent code sweep,
> 2026-07-21). Every file:line below was re-verified against the working tree.

## 1. Where SDK-007 sits

Sequence: `SDK-001…005 ✓ → **SDK-007 (Email sandbox)** → SDK-008 (2-channel routing sandbox) → SDK-010
(Journeys sandbox)`. This is the first item of the **sandbox program** (option 2): build the full
managed Email + routing + Journey surface against fakes, and defer every live path (SDK-006/009/011) to
admin-console config behind the live redline — **no visible-but-dead live control ships**
(backlog §Delivery policy, lines 40–55).

SDK-007 makes the managed layer **multi-channel**. It turns the SMS-only managed engine into a
channel-dispatched one: a business user authors an **Email variant** on a definition, releases it to
sandbox, previews subject/text/HTML, and a developer sends it with the **unchanged** `messages.send`
call — now compile-time constrained to the definition's channel. Dispatch runs through the **existing**
sandbox `FakeEmailProvider`, not a second engine.

**Dependencies — met:**
- SDK-005 managed SMS sandbox ✓ (delivery/attempt/idempotency/worker/wallet/webhooks/logs in prod).
- Direct sandbox Email path operational ✓ — `services/api/src/email/email.service.ts` (send/list/retrieve
  through `FakeEmailProvider`, PII vault, `outbox(channel:"email")`), sandbox-gated by
  `assertSandboxEnvironment` (`email.service.ts:175`).

**This item CANNOT close unless it also lands the inherited SDK-004-AC02 channel narrowing** — the
generated catalog must emit `channel` per definition and the typed `messages.send` must reject a
channel-unsupported call at compile time, with a `@ts-expect-error` fixture (backlog SDK-007 "Inherited
criterion"; sdk-004 evidence §AC02). Email is the first second channel, so the guard that guarded
nothing under SMS-only now becomes real here.

**Readiness gaps that block "ready" (close before/at slice 0):**
- **ADR gate (backlog line 135).** Adding Email introduces (a) polymorphic definition content and (b) a
  channel-dispatch step in the managed engine. This is an **extension of ADR-0005's already-reserved
  `channels` concept, not a new state machine** — so it needs a **light ADR-0005 amendment** recording
  the channel-dispatch + polymorphic-content decision, not a fresh ADR. (Contrast: SDK-008 routing and
  SDK-010 Journeys each introduce a genuinely new state machine and DO need their own ADR — out of
  scope here, flagged in their own readiness docs.)
- **Email sandbox pricing basis is undecided.** SMS prices by `rateSegments` (segment count). Email has
  no segments. The managed Email delivery still needs an **exact `MinorUnits` cost** for the wallet
  reserve/settle path and the preview's estimated cost. Decision required: flat per-message sandbox
  price (recommended — deterministic, matches how the direct Email path is metered today) vs.
  size-tiered. Owner: product + platform. **Blocks slice 3 (preview) and slice 4 (send).**
- **Sending-domain binding status.** AC requires preview to report "binding status" and a sandbox key to
  be unable to select a live domain. Confirm what sandbox domain-binding state exists today (direct
  Email path) and whether preview reads it read-only. Owner: platform.
- Named product / technical / QA / operational / security reviewers (backlog Global Definition of Ready).

## 2. Reuse surface (verified against code)

The managed engine was built **channel-aware**: `message_deliveries.channel` and
`message_delivery_attempts.channel` already exist and the containment FKs are channel-neutral (link
definition/version/env, not the SMS `messages` table). Only two CHECK constraints pin `channel = 'sms'`.
Email is therefore an **extension**, not a parallel engine.

| Concern | Source (file:line) | Action |
| --- | --- | --- |
| Delivery / attempt persistence, idempotency (fingerprint + deterministic id), cost-cap, PII vault, retrieve/list/webhooks | `services/api/src/messages/managed-messages.service.ts:30` (send), `:153` fingerprint, `:160` deterministic id; reads in `managed-messages-reads.ts` | **Reuse as-is.** All channel-neutral. |
| Delivery/attempt tables | `packages/db/src/schema/managed-messages.ts` — `channel` cols already present; FKs channel-neutral | **Relax CHECKs** `:78` + `:173` from `= 'sms'` to `IN ('sms','email')`. One migration. Confirm the per-attempt channel-message reference is a plain column, not a hard SMS FK. |
| `validatePayload` (variable schema → path-coded errors, no value echo) | `packages/domain/src/message-render.ts:57` | **Reuse as-is.** Channel-agnostic. |
| `previewSms` (render → encode → segment → rate) | `packages/domain/src/message-render.ts:167` | SMS-specific. **Add `previewEmail`** (subject/text/HTML render + email price) and a channel-dispatching `previewMessage`. Renderer parity with send is load-bearing (§5). |
| Direct Email dispatch: `FakeEmailProvider`, persist, PII vault, `outbox(channel:"email")` | `services/api/src/email/email.service.ts:25`, `:65`, `:175` | **Reuse as the Email runtime** the managed path delegates to — exactly as managed SMS reuses the SMS engine. Refactor `FakeEmailProvider` instantiation + `assertSandboxEnvironment` into a channel-agnostic provider-selection seam. |
| SMS managed dispatch worker + recheck | `services/api/src/sms/sms-send.worker.ts`, `sms.service.ts:167`, `sms-dispatch-recheck` | Pattern reused. **Add an Email dispatch path** (own queue/worker or a channel branch in the managed dispatch) with an Email attempt-time recheck (kill-switch/consent/domain). |
| Definition version content | `packages/db/src/schema/message-definitions.ts:104` (`content` jsonb — polymorphic-ready) | Add a **`channel` discriminator column** on versions; define **`emailVariantContent`** (subject/text/html + locale) in `@app/contracts`, discriminated on channel. `variableSchema` unchanged. |
| Definition authoring UI | schema editor `DefinitionSchemaEditor` + `definition-authoring.ts` (channel-agnostic); `create-definition-dialog.tsx` (SMS-hardcoded) | Reuse the schema editor. **Channel-parameterize** the create/edit dialog + preview panel; add Email content fields. |
| Idempotency / queue / cron / kill-switch / wallet / `asInsufficientFunds` | `idempotency.service.ts`, `queue.service.ts`, `maintenance.service.ts`, `kill-switches.service.ts`, `packages/wallet` reserve/commit/refund, `http/api-error.ts:99` | **Reuse as-is.** Shared plumbing. |
| Catalog generation + `Fabric<Catalog>` (SDK-004) | `packages/cli/src/generate.ts`; `packages/sdk` catalog types | **Extend** to emit `channel` per definition and narrow `messages.send` by channel (closes AC02). |

**Do NOT duplicate:** there is exactly one managed send service, one delivery table, one idempotency
service, one wallet. Email extends each; it does not fork any.

## 3. Schema changes (additive, drift-safe)

1. `message_definition_versions`: add `channel text not null default 'sms'` (backfill-safe; existing rows
   are SMS). Content stays `jsonb`, now discriminated by channel in the contract layer.
2. `message_deliveries` + `message_delivery_attempts`: relax the two `channel` CHECKs to
   `IN ('sms','email')` (raw-SQL migration, `DROP CONSTRAINT` + `ADD CONSTRAINT`, idempotent).
3. Email variant content shape lives in `@app/contracts` (zod discriminated union on `channel`):
   `{ channel:"sms", body }` | `{ channel:"email", subject, text?, html? }`. Compatibility analysis
   (`analyzeCompatibility`) extends: adding a channel variant = compatible; removing a released channel =
   breaking (already in the SDK-003 compatibility table).

No new top-level table. RLS/containment already hold on the delivery/attempt/definition tables; the
Email delivery reuses them unchanged. Every changed table keeps its cross-tenant + cross-application
denial tests; add channel-specific rows to them.

## 4. Decomposition (vertical slices, dependency order)

Feature stays **invisible** (no Email channel selector, no catalog channel, no capability-matrix entry)
until the release gate — every slice below green. Each slice carries its own unit / real-Postgres tests.

0. **Design lock** — *no code.* ADR-0005 amendment (channel dispatch + polymorphic content); decide the
   Email sandbox **pricing basis**; confirm sandbox domain-binding read; name owners. Produce the
   traceability table (backlog §Verification model). Gate: product + security sign-off.
1. **Contracts + schema** — `channel` on versions; `emailVariantContent` discriminated union; delivery/
   attempt CHECK relax; `analyzeCompatibility` channel rules. Real-Postgres: version immutability +
   containment still hold with an email row; CHECK accepts `email`, rejects a third value. Drift green.
2. **Email render + preview core** — `previewEmail` (subject/text/HTML render, contextual HTML escaping,
   size limits, locale, price) + channel-dispatching `previewMessage` in `@app/domain`. Unit: escaping/
   injection/size, no-value-echo on error, preview↔send parity fixture.
3. **Preview endpoint (Email)** — `POST /v1/messages/preview` resolves an Email release and renders via
   the slice-2 core; blockers/binding-status/price; no side effects (assert wallet/outbox/PII counts
   unchanged). Reuses the SDK-003 endpoint; adds channel branch.
4. **Managed Email send + dispatch** — refactor the managed send to channel-dispatch: SMS → SMS engine
   (unchanged), Email → the Email runtime (FakeEmailProvider path). Wallet reserve/settle by the slice-0
   price; delivery/attempt rows with `channel:"email"`; acceptance + terminal outbox events; attempt-time
   Email recheck. Real-Postgres: send parity with preview, idempotency (concurrent + conflict), crash
   recovery + exactly-one refund, negative gates (unsafe HTML / bad recipient / oversized / insufficient
   funds → 402 / unbound domain), direct `sms.send` + managed SMS still work.
5. **Catalog + SDK (closes AC02)** — generator emits `channel`; `Fabric<Catalog>` narrows
   `messages.send` by channel; `@ts-expect-error` fixture proves a channel-unsupported call fails to
   compile. Update the sdk-004 evidence AC02 row from "non-applicable" to "implemented". `release:check`.
6. **Dashboard** — channel-parameterized create/edit dialog + Email content fields + channel-aware
   preview panel; delivery logs/detail already channel-neutral (verify Email rows render). Role/permission
   gating unchanged. Component/E2E for all states.
7. **Docs + evidence** — `docs/sdk/evidence/sdk-007.md` (AC01–AC05 + inherited AC02), capability matrix
   flips Email→managed, changelog, examples, OpenAPI regenerated + `openapi:check`.

## 5. Key risks / watch-items

- **Renderer parity (load-bearing, same as SDK-003).** `previewEmail` and managed Email send must render
  byte-identically. Build the Email renderer once in `@app/domain`; the send path consumes it — never
  render inline in the service.
- **HTML injection.** Email variables interpolated into HTML need contextual escaping; a variable must
  not break out of its attribute/text context. Escaping tests are a release gate (backlog SDK-007
  verification: "renderer escaping/injection/size tests").
- **Pricing basis must be locked before slice 3** — preview cost and send cost read the same source, or
  the "preview matches send" AC fails for Email.
- **No live leakage.** Sandbox key must not select a live domain/provider; `assertSandboxEnvironment`
  stays enforced on the Email path. Live Email is SDK-009 — absent here, not a dead toggle.
- **AC02 is a completion condition, not a nicety** — the channel narrowing must ship in slice 5 or
  SDK-007 cannot close (and it retroactively makes SDK-004's deferral valid).

## 6. Recommended first executable step

Slice 0 is a decision/sign-off gate (ADR-0005 amendment + pricing basis + owners) — **not code**. The
first **code** step is **slice 1** (contracts + schema + CHECK relax + compatibility rules + real-Postgres
tests): the additive foundation every later slice builds on, independently verifiable, and reversible.
Recommend drafting the slice-0 design note next (locking the pricing basis and the ADR-0005 amendment),
then starting slice 1 on an explicit go.
