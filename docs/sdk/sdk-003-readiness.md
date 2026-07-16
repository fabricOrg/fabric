# SDK-003 readiness & decomposition — author/version/release/preview managed SMS definitions

> Status: readiness draft — 2026-07-15. Precedes implementation. Companion to the
> [SDK backlog](./managed-messaging-sdk-backlog.md#sdk-003---author-version-release-and-preview-managed-sms-definitions),
> [ADR-0005](../decisions/0005-managed-messaging-sdk-resource-model.md) (resource model),
> and the [architecture plan](./managed-messaging-architecture-plan.md) (data model + invariants).

## 1. Where SDK-003 sits

Sequence: `SDK-001 (contract normalization) ✓ → SDK-002 (webhook reliability) ✓ → **SDK-003** → SDK-004/005`.
SDK-003 is the first slice of the managed layer: it lets a business user author a reusable, versioned
SMS **definition** (stable key + variable schema + content), release an immutable version to an
environment, and **preview** it through the same rendering/pricing/segmentation code a send uses — with
**zero side effects** (no wallet, provider, outbox, or PII write).

**Dependencies — met:**
- SDK-001 normalized contract ✓ (committed).
- Workspace→Application→Environment hierarchy (ADR-0004) in end-to-end ✓ — `applications` +
  `environments` schema (`packages/db/src/schema/applications.ts`), request carries
  `req.tenant.{applicationId,environmentId}` (`services/api/src/api-keys/api-key.guard.ts:22-27`),
  dashboard Applications surface shipped (`e0f87e5`).

**Readiness gaps that block "ready" (must close before/at slice 0):**
- ADR-0005 is **`proposed` — requires product + security review before implementation** (its own
  status line). Runtime-vs-management scope split (decision #6) needs the security review named in its
  follow-ups.
- ADR-0005 follow-ups still open: the **portable variable-schema subset** and the **compatibility
  algorithm** are unspecified. SDK-003 cannot lock its stable-key/compatibility rules until these land.
- Per the backlog global Definition of Ready: named product / technical / QA / operational owners.

## 2. Reuse surface (verified against code)

Side-effect boundary is clean: **`packages/domain` is pure; `packages/sms-engine/src/engine.ts`
mutates.** The preview endpoint composes the pure pieces and never touches the engine.

| Concern | Source | Action |
| --- | --- | --- |
| Encoding (GSM7/UCS2) + segment count | `packages/domain/src/segmentation.ts:66` `encodeAndSegment()` | **Reuse as-is.** Pure. Single source of truth (send calls it at `engine.ts:146`). |
| Cost / pricing (`bigint` minor units) | `packages/domain/src/rating.ts:24` `rateSegments()` | **Reuse as-is.** Pure. |
| Sender status / binding | `services/api/src/senders/senders.service.ts:76` `isActiveSender()` | Reuse — read-only. |
| Compliance/consent gates | `services/api/src/sms/sms-compliance.ts:14` `assertSendCompliant()`; `destinationCountry():63`; consent `promoWindowOpen`/`isSuppressed` | Extractable but **throws**. Add a **non-throwing variant** that returns structured blockers/warnings for preview. |
| **Body rendering / variable substitution** | **No server-side renderer exists.** Only client-side `apps/dashboard/lib/send/preflight.ts:240` `renderTemplate()` + `:230` `extractTokens()` + token regex `:227` | **NET-NEW.** Build a server-authoritative renderer in `packages/domain` (or a new `packages/messaging`); port the token grammar. This becomes the single source both preview and future managed send (SDK-005) consume. |
| Template model (for conversion) | `sms_templates` table `packages/db/src/schema/sms-templates.ts:6` (tenant-scoped only, **no app/env, no variable schema**); service `sms-templates.service.ts` | Conversion is net-new; template has no variable schema — must be derived/reviewed, never silent. |

**Do NOT call** (side effects the no-side-effect gate asserts stay untouched): `engine.prepareSend`
(`engine.ts:142` — INSERT messages + `reserve()`), `dispatchSend` (`:199`), `resolveMessage` outbox
insert (`:111`), `piiVault.put` (`sms.service.ts:122`), queue enqueue, `autoTopup.maybeAutoTopUp`,
`virtualPhone.record`.

No existing `preview`/`definition` API — no dedup risk; build fresh under the contracts naming pattern
(`packages/contracts/src`, `xxxRequest`/`xxxResponse`, `request_id` envelope, money via shared `money`).

## 3. Schema (from architecture-plan invariants)

Three new app/env-scoped tables (drizzle-generated), following the `messages` app/env scoping pattern.
FORCE RLS on every one; runtime reads include tenant+app+env predicates.

- **`message_definitions`** — `id`, `tenant_id`, `application_id`, `key` (stable key), `status`
  (`draft|active|archived`), timestamps. Invariant: `UNIQUE (tenant_id, application_id, key)`.
- **`message_definition_versions`** — `id`, `tenant_id`, `definition_id`, `version` (ordinal),
  variable schema (jsonb), SMS variant content, locale/default-locale, `created_by`, `created_at`.
  Invariants: `UNIQUE (definition_id, version)`; **insert-only for runtime role — no UPDATE/DELETE
  grant** (published content never changes).
- **`message_definition_releases`** — `id`, `tenant_id`, `environment_id`, `definition_id`,
  `version_id`, timestamps. Invariants: `UNIQUE (tenant_id, environment_id, definition_id)` (one active
  release per definition/env); **composite containment FKs** carrying tenant+application+definition+
  environment so a release cannot cross application or tenant.

Hot-path index: released definition by `(environment_id, key)`. Every table gets a cross-tenant denial
integration test through the real runtime role, plus a cross-application release-rejection test.

**Stable-key grammar & compatibility** (blocked on ADR-0005 follow-up): adding an optional variable or
locale = compatible; removing/renaming a variable, tightening validation, changing type, removing a
released locale/channel, or changing requiredness = **breaking → new stable key**. Encode as a pure,
unit-tested `analyzeCompatibility(prev, next)`.

## 4. Decomposition (vertical slices, dependency order)

Each slice is independently shippable behind the release gate and carries its own real-Postgres/unit
tests. The feature stays **invisible** until slice 6's gate conditions all pass (backlog release gate).

0. **Design lock** — close the readiness gaps: ADR-0005 product+security review sign-off; specify the
   variable-schema subset + compatibility algorithm; name owners. *No code.* Design note drafted:
   [sdk-003-slice0-design.md](./sdk-003-slice0-design.md) — awaiting product+security sign-off.
1. **Schema + RLS + invariants** — DONE (`699a86e`). The three tables (migrations `0075` DDL + `0076`
   RLS), composite containment FKs, functional case-insensitive key index, version immutability via
   explicit REVOKE. Real-Postgres gate: 9 tests (isolation + fail-closed, WITH CHECK denial, key
   uniqueness, version UPDATE/DELETE immutability, one-release-per-env, cross-app release rejection).
   `db:assert` + `db:assert:drift` green.
2. **Contracts + compatibility engine** — DONE (`d4bfdc8`). `@app/contracts`: stable-key grammar,
   closed variable-schema subset (strict nodes, path-coded bound checks), definition/version/release
   DTOs. `@app/domain`: pure `analyzeCompatibility` (per-field verdict + JSON paths). 22 + 12 unit
   tests. OpenAPI wiring deferred to slice 4/5 (endpoints don't exist yet).
3. **Server-side renderer + preview core** — DONE (`8bb37a8`). `@app/domain/message-render.ts`:
   `validatePayload` (subset → path-coded errors, no value echoed) + `previewSms` (token-declared check
   → validate → render → `encodeAndSegment` → `rateSegments`; bounded; blockers ⇒ nothing rendered).
   11 tests incl. preview↔send parity + no-PII-in-errors. Sender/compliance + resolved-locale/version
   enrichment and the HTTP endpoint (with the no-side-effect integration test) move to slices 4/5.
4. **Management API + authoring** — DONE (`ec96a2d`). `v1/message-definitions`
   create/list/add-version/publish/archive. Authority (ADR-0005 #6): operator or dashboard-session
   (BFF token, `applicationId===null`); a scoped `sk_*` key is rejected (`management_requires_session`).
   Breaking version rejected; publish upserts the single sandbox release + audits; live refused. 7
   real-Postgres + 5 controller unit tests. Role gating (member draft-only / developer read-only) is
   enforced at the BFF — lands with the dashboard surface in slice 6.
5. **Public preview endpoint** (`messages.preview`) — released-definition preview via the slice-3 core.
   **Parity test:** preview render/encoding/segments/cost == a subsequent managed send on the same
   release + pricing state (this is why slice 3's renderer must be the single source SDK-005 also uses).
   No-side-effect integration test: assert wallet, provider, outbox, PII vault all untouched.
6. **Dashboard surface + release gate** — list/create/edit/validate/publish/archive + **Use-in-code**
   panel (stable key, schema, env, untyped SDK example) + explicit template→draft conversion (review
   key/schema/sender/locale/content; original template unchanged). Error/loading/empty as first-class
   states. Accessible component/E2E for all states. **Gate: visible only when create, edit,
   publish-to-sandbox, preview, permissions, and audit are all functional; no live button, no
   unsupported channel selector.**
7. **SDK + docs** — SDK `messages.preview` + read-only definition discovery; OpenAPI/contract parity;
   evidence doc `docs/sdk/evidence/sdk-003.md` with AC traceability.

## 5. Key risks / watch-items

- **Renderer parity is the load-bearing invariant.** If managed send (SDK-005) renders differently from
  preview, AC "preview matches subsequent send" fails. Build the renderer once, in `packages/domain`,
  and make SDK-005 consume it — do not let send keep storing body raw for the managed path.
- **Runtime keys must not publish** (least privilege). The management endpoints need a dashboard-session
  guard, not the `sk_*` ApiKeyGuard — new guard surface + security tests.
- **Immutability must be enforced by grants, not app code** — no UPDATE/DELETE grant to `app_runtime`
  on version rows; prove it with an RLS/grant integration test.
- **No PII on preview failure** — renderer errors return field paths only; assert nothing persists.

## 6. Recommended first executable step

Slice 0 is a decision/sign-off gate (product + security), not code. The first **code** step is **slice
1** (schema + RLS + invariants + real-Postgres tests) — it is the foundation every later slice builds on
and is independently verifiable. Recommend starting there once slice-0 sign-off (or an explicit human
go to proceed on the proposed ADR-0005) is in hand.
