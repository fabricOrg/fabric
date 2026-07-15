# SDK-003 slice 0 — stable-key grammar, variable-schema subset, compatibility algorithm

> Status: design draft for review — 2026-07-15. Closes the two open
> [ADR-0005](../decisions/0005-managed-messaging-sdk-resource-model.md) follow-ups
> ("specify the portable variable-schema subset and compatibility algorithm") and specifies the
> stable-key grammar that the backlog references but leaves undefined. Consolidates prior DX thinking
> in [iteration-2 §Contract compatibility](./sdk-dx-iteration-2.md) and
> [iteration-3 §Renderer](./sdk-dx-iteration-3.md). Requires product + security sign-off before
> SDK-003 slice 1. Non-code.

## 0. Why this exists

SDK-003 slices 1–3 encode these three things directly into schema, migrations, and a renderer:

- the **stable key** is a persisted `UNIQUE` column and the developer-facing contract;
- the **variable schema** is a persisted jsonb blob the server validates payloads against and the CLI
  generates types from — so it cannot depend on TypeScript and cannot be Turing-complete;
- the **compatibility algorithm** decides whether an edited version keeps the same stable key or forces
  a new one, and it must be identical in the dashboard, the CLI, and the API (callers may run stale
  catalogs or other languages — TS generation alone never proves safety, ADR-0005 #5).

Getting these wrong is expensive to reverse once definitions exist, so they are locked here first.

## 1. Stable-key grammar

A stable key identifies a definition **within one application** (`UNIQUE (tenant_id, application_id,
key)`). It is chosen by the author, never reused for a different meaning, and appears verbatim in
customer source code (`fabric.messages.send("order.shipped", …)`).

**Grammar (locked):**

- lowercase ASCII; segments of `[a-z][a-z0-9]*` joined by `.`; within a segment `-` may separate words.
- regex: `^[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z][a-z0-9]*(-[a-z0-9]+)*)*$`
- length 1–128; at most 8 dot-segments; no leading/trailing/double `.` or `-`.
- reserved prefix `fabric.` is rejected for customer keys.
- **case-insensitive uniqueness** — persist as given, enforce uniqueness on `lower(key)` to avoid
  `Order.Shipped` vs `order.shipped` collisions in generated type namespaces.

Rationale: dotted lowercase is already the convention in every doc example (`order.shipped`,
`order.delivery-follow-up`); the segment cap keeps generated catalog namespaces bounded; reserving
`fabric.` leaves room for platform-owned system definitions.

The stable key is **immutable** once any version exists. Renaming a key is modeled as a new definition
plus archival of the old one, never an update — this is what makes "the key is the contract" true.

## 2. Portable variable-schema subset

Persisted as a documented, closed **JSON Schema subset** (not zod — zod stays the runtime TS validator
the API compiles the subset into). Deliberately non-executable (iteration-3): the renderer that consumes
it must have bounded time/size/nesting and no code execution.

**Allowed:**

| Construct | Constraints |
| --- | --- |
| `object` (root must be an object) | closed — `additionalProperties: false`; named properties; each required or optional; max 64 properties; max nesting depth 5 |
| `string` | optional `minLength`/`maxLength` (hard cap 4096), `enum` (≤ 64 members), `format` from a closed allow-list (`email`, `e164`, `url`, `date`, `datetime`, `uuid`) |
| `integer` / `number` | optional `minimum`/`maximum` |
| `boolean` | — |
| `array` | single homogeneous `items` schema from this subset; required `maxItems` (hard cap 1000); optional `minItems` |

**Rejected (hard fail at authoring):** `$ref`/remote references, recursive schemas, `oneOf`/`anyOf`/
`allOf`/`not`, `patternProperties`, open objects, tuples, `null`-type, custom `format`, unbounded
strings/arrays, and any payload whose serialized schema exceeds 32 KB. These match iteration-2's
"reject arbitrary code, recursive schemas, remote references, and unbounded payloads."

**Rendering contract (feeds slice 3's renderer):** field-level validation errors carry a JSON path and a
stable code, **never the rejected value** (no PII in errors — iteration-3). Token grammar in templates is
`{{ path.to.var }}` resolving only against declared schema paths; an undeclared token is an authoring
error, not a runtime blank. Bounded render output size and collection iteration; context-aware escaping
is a no-op for SMS (plain text) but the interface reserves it for email/rich channels.

## 3. Compatibility algorithm

`analyzeCompatibility(released, candidate)` is a **pure function** over the two variable schemas (and the
released locale/channel set). It returns `compatible | breaking` plus a list of per-change reasons with
field paths. Same code in dashboard, CLI, API. It reconciles the backlog rules with iteration-2:

| Change (released → candidate) | Verdict |
| --- | --- |
| Add an **optional** property | compatible |
| Add a **required** property | **breaking** |
| Remove or rename a property | **breaking** |
| Change a property's type | **breaking** |
| Make an optional property required | **breaking** |
| Make a required property optional | compatible |
| Narrow a constraint (raise `minLength`, lower `maxLength`/`maximum`, shrink `enum`, tighten `format`) | **breaking** |
| Widen a constraint (lower `minLength`, raise `maxLength`/`maximum`, grow `enum`, relax `format`) | compatible |
| Add a locale / channel | compatible |
| Remove a released locale / channel in use by callers | **breaking** |
| Content-only edit (no schema change) | compatible — **but still a new immutable version** |

Rules:

- A **compatible** candidate may publish a new immutable version under the **same** stable key.
- A **breaking** candidate must be published under a **new** stable key (the API rejects a same-key
  publish whose analysis is breaking). A breaking version *may* be released to **sandbox** deliberately
  for coordinated dev, but that is an explicit, audited action; **live promotion of a breaking change
  requires explicit human acknowledgement** and evidence dependents updated (deferred to SDK-005/006's
  live path — no live button in SDK-003).
- "Rename" is indistinguishable from remove+add at the schema level, so it is reported as breaking; the
  authoring UI may offer an explicit rename affordance that still forces a new key.

## 4. What this unblocks / hands to later slices

- **Slice 1** persists `key` with the §1 grammar (`UNIQUE`, case-insensitive) and stores the §2 schema
  jsonb on version rows (insert-only for the runtime role).
- **Slice 2** implements the §2 subset validator (JSON-Schema-subset → zod compiler) and the §3
  `analyzeCompatibility` as pure, unit-tested functions in `@app/contracts`/`@app/domain`.
- **Slice 3** builds the renderer to the §2 rendering contract (bounded, non-executable, path-coded
  errors, no PII).

## 5. Open items for the review sign-off

- **Security:** confirm the schema-size/nesting/array caps are low enough to bound renderer cost under
  the broadcast amplification model (iteration-3), and that the closed subset admits no
  code-execution/SSRF path (no remote `$ref`, no URL fetch during render).
- **Product:** confirm the `format` allow-list and the "breaking → new key" hard rule (vs. allowing an
  acknowledged same-key breaking sandbox release) match the intended authoring UX.
- **Naming:** ratify the reserved `fabric.` prefix and the 8-segment / 128-char key caps.
