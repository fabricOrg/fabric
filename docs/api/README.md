# Fabric API reference

Two generated OpenAPI 3.1 documents, both produced from the same source by one generator:

| file | contains | publishable |
| --- | --- | --- |
| [`openapi.json`](openapi.json) | the customer surface — every route an `sk_*` key opens | **yes** |
| `openapi.internal.json` | everything, `/internal/*` and provider webhooks included | **no — never distribute** |

`packages/sdk/openapi.json` is a byte-identical copy of the public document, shipped in the SDK
tarball. It is written by the same generator; the SDK no longer has one of its own.

## Regenerate

```bash
pnpm openapi:generate      # writes all three artifacts
pnpm openapi:check         # fails when a committed artifact is stale (runs in `pnpm validate`)
```

Nothing is booted. Routes are read from the controllers' decorator metadata and schemas from the
zod contracts in `packages/contracts`, so generation needs no database, no Redis and no environment.

## What is derived, and what is not

**Derived — cannot drift:**

- the route list, from every `@Controller` / `@Get` / `@Post` … in `services/api/src`;
- every request and response schema, from `@app/contracts` via `z.toJSONSchema()`.

Request bodies serialise with `io: "input"` and responses with `io: "output"`. That distinction is
real: wherever a contract carries a default or a transform, the shape a caller SENDS differs from the
shape it RECEIVES. `bigint` money renders as an exact decimal string, never a JSON number, because a
number loses precision past 2^53.

**Hand-written — the only place intent lives:** `services/api/src/openapi/route-bindings/`. One entry
per route carrying its summary, tags, security scheme, and `visibility` (`public` | `internal` |
`webhook`). **A route with no binding fails the build**, and so does a binding naming a route that no
longer exists.

`visibility` follows the GUARD, not the path. `ApiKeyGuard` means a customer key already reaches the
route, so it is `public`; `BffTokenGuard` means only a server-side BFF can call it. `/v1` on its own
means nothing — several `/v1` routes are dashboard features that a key nonetheless opens.

## Testing it — two commands

**Look at it:**

```bash
pnpm docs
```

Serves the reference at `http://localhost:4000` and opens a browser. No API, no database, no
credentials, no auth prompt — it reads the committed artifact. `pnpm docs:public` shows the customer
artifact instead of the internal one.

**Check it is true:**

```bash
pnpm contracts:probe        # with the API running
```

Calls every documented GET and reports anything that is not a 2xx. It is self-configuring: it reads
ids from the database, mints its own tenant token, and creates a temporary API key which it revokes
afterwards — including when it fails. The only inputs are the values the API was already started
with (`BFF_INTERNAL_TOKEN`, `OPERATOR_TOKEN`) plus a `DATABASE_URL_*`, which `.env` normally has.

It exits non-zero **only** on a `response_contract_violation` — the published schema disagreeing
with the real payload. A 404 for a row this database does not have, or a 401 for a credential it was
not given, says nothing about the specification, so those are reported and not failed. A route whose
path parameters cannot be resolved is SKIPPED rather than called with an invented id.

**Third, and it runs on every push anyway:**

```bash
pnpm openapi:check          # no database, no API; inside `pnpm validate`
```

Fails when a route has no binding, a binding names a dead route, or the committed artifact is stale.

### Why `pnpm docs` and not the API's own `/docs`

The API serves the same document at `/docs`, gated on `OPERATOR_TOKEN` and failing closed, because
it describes `/internal/admin/*` — kill switches, impersonation, wallet adjustment. That gate is
right for a deployed service and wrong for reading the spec on your laptop, where it costs an env
var, a running API and a Basic-auth prompt. Use `/docs` when you need the reference on a deployed
environment; use `pnpm docs` locally.

**CLAUDE.md §12 makes this a rule**: no endpoint may be consumed anywhere until it is bound, present
in the artifact, and has returned a real 2xx from `contracts:probe` or an integration test.

## Browsing it

`GET /docs` renders the **full** document, gated by `OPERATOR_TOKEN` and failing closed: no token
configured means 404, not open docs. Browsers authenticate with HTTP Basic (any username, the token
as the password); scripts send `x-operator-token`.

## Authentication

Send application credentials as `Authorization: Bearer sk_test_…` or `sk_live_…`. These are for
trusted servers only and are unrelated to WorkOS dashboard sessions.

## Compatibility

Path-versioned under `/v1`. Additive fields are compatible. Removing or renaming a field, changing
its meaning, or tightening accepted input requires a migration plan and a new compatible surface
rather than silently breaking v1.

## Known gaps

**60 of 72 writes carry a request contract; 75 of the 122 operations that return a body carry a
response contract.** The gaps are deliberate and each is one of four kinds:

- **no body by design** — 204 deletes, `clone`, `archive`, mark-read, template-sync;
- **not our shape** — the five provider webhook ingress routes carry Meta's, Paystack's, Arkesel's
  and SNS's payloads;
- **no DTO exists** — mostly single-resource admin writes returning service-layer objects. Verified
  by exhausting the exports of `@app/contracts`, not assumed;
- **two recorded defects**, marked `TODO(contract)` at the binding with the reason:
  `POST /v1/api-keys` parses its body with an unchecked cast and has no DTO at all, and
  `POST /v1/flows` resolves a discriminated union at runtime on `action`.

A missing schema is visible in the document rather than implying the endpoint takes or returns
nothing. No shape is ever hand-written to fill a gap — that is the failure this pipeline replaced.
