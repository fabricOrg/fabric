# SDK-007 slice 0 — channel model, size-tiered Email pricing, ADR-0005 amendment

> Status: design draft for review — 2026-07-21. Precedes SDK-007 slice 1. Locks the two decisions the
> [readiness doc](./sdk-007-readiness.md) flagged as blockers — the **channel/content model** and the
> **Email sandbox pricing basis** — and proposes the **[ADR-0005](../decisions/0005-managed-messaging-sdk-resource-model.md)
> amendment** that ratifies them. Requires product + security sign-off before slice 1. **Non-code.**
> Does not edit ADR-0005: ratification of §5 is this note's sign-off gate.

## 0. Why this exists

SDK-007 turns the SMS-only managed engine multi-channel. Three things are expensive to reverse once
Email deliveries exist and must be locked first:

- how a definition version **declares its channel** and carries **polymorphic content** (SMS body vs
  Email subject/text/html);
- how a managed Email send is **priced** — SMS bills by segment count, Email has no segments, yet the
  wallet reserve/settle path and the preview both need an exact `MinorUnits` figure that **preview and
  send compute identically**;
- that this is an **extension of ADR-0005's already-reserved channel concept, not a new state machine**,
  so it amends 0005 rather than opening a new ADR (SDK-008 routing and SDK-010 Journeys, which each add
  a real state machine, get their own ADRs).

## 1. Channel & content model (locked)

- A definition **version declares exactly one channel** (`channel` column on
  `message_definition_versions`, default `'sms'` — existing rows backfill safe). A definition may hold
  versions of different channels over time, but one released version = one channel. Multi-channel *within
  one intent* is routing (SDK-008), not SDK-007.
- **Content is polymorphic**, discriminated on channel, in `@app/contracts` (the DB column stays
  `jsonb`, no shape migration):
  - `{ channel: "sms",   body: string }` (unchanged)
  - `{ channel: "email", subject: string, text?: string, html?: string }` — at least one of `text`/`html`
    required; both may be present (multipart). Same `{{ path.to.var }}` token grammar as SMS, resolving
    only against declared schema paths (SDK-003 slice-0 §2 rendering contract).
- **`variableSchema` is unchanged and channel-agnostic** — the same closed JSON-Schema subset validates
  payloads for both channels. A definition's variables don't change because its channel does.
- **Compatibility** (`analyzeCompatibility`) extends the SDK-003 table with the channel already covered
  there: "add a channel = compatible; remove a released channel in use = breaking." Because a version is
  single-channel, changing a definition's channel is modeled as a new version; if variables also change
  breaking, it forces a new stable key per the existing rule.

## 2. Size-tiered Email pricing (locked)

**Billable size — deterministic, rendered-output-based.** After variable substitution, the billable
size is the **UTF-8 byte length of the rendered payload**: `bytes(subject) + bytes(text ?? "") +
bytes(html ?? "")`. It is a pure function of the rendered output, so preview and send — which render
through the **same** `@app/domain` renderer — always land in the same tier. No provider round-trip, no
wall-clock, no PII in the measure.

**Tier table — half-open byte bands with a hard ceiling.** A pure
`rateEmailBySize(bytes, currency): MinorUnits` lives in `packages/domain/src/rating.ts` beside
`rateSegments`. The sandbox table (values are **placeholders re-sourced from real ESP rates at SDK-009
live** — sandbox uses seeded credits, so the figures are low-stakes but must be deterministic):

| Tier | Rendered size | Price (`MinorUnits`, delivery currency) |
| --- | --- | --- |
| `standard` | `≤ 50 KiB` (51 200 B) | base × 1 |
| `large` | `> 50 KiB, ≤ 150 KiB` (153 600 B) | base × 3 |
| `xlarge` | `> 150 KiB, ≤ 256 KiB` (262 144 B) | base × 6 |
| — | `> 256 KiB` | **no price — size-limit blocker** |

- `base` is the per-currency standard-email unit (a small constant, e.g. the same order as one SMS
  segment), defined in the rating module's sandbox price map. One currency per sandbox tenant; a
  multi-currency table is deferred to live (SDK-009 residual decision "live provider/domain/channel
  pricing").
- **Over 256 KiB is a blocker, not a price** — preview returns a bounded `email_payload_too_large`
  blocker (field-path only, no content echoed) and send is refused **before acceptance**. This is the
  same mechanism as the AC "oversized output blocks delivery without leaking rejected values."
- **`maxCost` interaction (unchanged path):** the caller's cost cap is compared against the tier price;
  over-cap fails closed pre-acceptance via the existing managed cost-cap gate — no Email-specific code.

Rationale for size-tiered over flat (the chosen basis): it models the real ESP billing shape (cost
scales with payload), so the sandbox cost surface exercises the same reserve/settle/refund arithmetic
the live path will use, and the SDK-009 live swap re-tunes only the numbers in one pure function — not
the delivery/wallet plumbing.

## 3. Channel dispatch & Email runtime (locked)

- The managed send resolves the released version's **channel**, then dispatches: `sms` → the SMS engine
  (unchanged), `email` → an **Email runtime** that wraps the existing direct-Email sandbox path
  (`FakeEmailProvider`, persist, PII vault, `outbox(channel:"email")`). One managed send service, one
  delivery/attempt table, one idempotency service, one wallet — Email extends, never forks.
- `previewEmail` (subject/text/html render + contextual HTML escaping + size measure + `rateEmailBySize`)
  and a channel-dispatching `previewMessage` join `previewSms` in `@app/domain`. The renderer is the
  **single source** both preview and send consume (renderer parity is the load-bearing invariant, §5).
- Delivery/attempt `channel` CHECK constraints relax from `= 'sms'` to `IN ('sms','email')`
  (`managed-messages.ts:78, :173`); the containment FKs (definition/version/env) are already
  channel-neutral and unchanged.

## 4. Catalog channel narrowing — closes SDK-004-AC02 (locked)

The generated catalog (SDK-004) gains a `channel` per definition key, and `Fabric<Catalog>` narrows
`messages.send` so a call whose payload targets a channel the released definition does not support
**fails to compile**. A `@ts-expect-error` fixture proves it. This retires the deferral recorded in
`docs/sdk/evidence/sdk-004.md` §AC02 (its reviewer note said the constraint would become real "at the
release item that first makes a second channel selectable" — that item is SDK-007). Runtime safety is
unchanged (the API re-validates every payload regardless).

## 5. Proposed ADR-0005 amendment (to ratify)

> **Amendment A1 (2026-07-21) — second managed channel: Email.** Records the implementation decisions
> for extending the managed layer to Email in sandbox (SDK-007). Amends, does not supersede, ADR-0005.
>
> 1. A managed definition **version is single-channel**; content is polymorphic, discriminated on
>    `channel` (SMS `body`; Email `subject`/`text`/`html`, ≥1 of text/html). `variableSchema` is
>    channel-agnostic and shared. Multi-channel-per-intent remains routing (deferred to SDK-008,
>    which will carry its own ADR).
> 2. The managed engine **dispatches by channel** onto per-channel runtimes; Email reuses the existing
>    direct-Email sandbox provider path as its runtime. No second engine, delivery table, idempotency
>    store, or wallet.
> 3. Delivery/attempt rows are **channel-tagged** (`channel` column; CHECK `IN ('sms','email')`); the
>    delivery aggregate (ADR-0005 #1) is unchanged — it already owns zero-or-more channel attempts.
> 4. **Pricing is per-channel and pure:** SMS by `rateSegments`, Email by `rateEmailBySize` (size-tiered,
>    rendered-byte bands with a hard-ceiling blocker). Preview and send price through the same function.
> 5. The generated catalog carries `channel` and **compile-time constrains `messages.send`** by it,
>    closing the ADR-0005 follow-up "AC02 channel clause" (was recorded non-applicable while SMS was the
>    only channel).
> 6. Execution/acceptance/idempotency/webhook/privacy semantics are unchanged — ADR-0006 governs them
>    and applies to the Email runtime as-is.
>
> **Scope guard (from the backlog):** no live Email path, provider, domain selector, capability-matrix
> entry, or catalog channel ships until its real execution path exists and is tested. Live Email is
> SDK-009, behind the live redline. Sandbox Email remains absent from all public surfaces until the
> SDK-007 release gate.

## 6. What this unblocks / hands to later slices

- **Slice 1** adds the `channel` column + `emailVariantContent` contract + CHECK relax + compatibility
  channel rules, with real-Postgres tests (immutability + containment hold for an email row; CHECK
  accepts `email`, rejects a third value).
- **Slice 2** builds `previewEmail`/`previewMessage` + `rateEmailBySize` as pure, unit-tested functions
  (escaping/injection/size, no-value-echo, preview↔send parity).
- **Slices 3–4** wire the preview endpoint and the channel-dispatched send + Email runtime.
- **Slice 5** ships the catalog `channel` narrowing (closes AC02).

## 7. Open items for the review sign-off

- **Product:** ratify the **tier boundaries** (50/150/256 KiB) and the `base` unit price relative to one
  SMS segment; confirm size-tiered (not flat) is the intended sandbox metering; confirm 256 KiB as the
  hard Email payload ceiling.
- **Security:** confirm the rendered-size measure and HTML escaping close the injection/amplification
  surface (a variable cannot break HTML context; size ceiling bounds render cost); confirm no live
  domain/provider is selectable by a sandbox key.
- **Architecture:** ratify Amendment A1 against ADR-0005 (extension, not new ADR) and confirm SDK-008 /
  SDK-010 will each carry their own ADR for their new state machines.
- **Naming:** ratify `channel` discriminator + `emailVariantContent` field names and the
  `email_payload_too_large` blocker code.
