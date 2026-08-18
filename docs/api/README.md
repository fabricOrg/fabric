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

## Handing it to QA (a deployed environment)

The testing API serves the reference at **<https://fabric-jezz.onrender.com/docs>**.

Sign in with HTTP Basic: **any username**, and `OPERATOR_TOKEN` as the **password**. The browser
keeps it for the realm, so the token is entered once and never appears in a URL. Scripts skip Basic
and send the header directly:

```bash
curl -H "x-operator-token: $OPERATOR_TOKEN" https://fabric-jezz.onrender.com/docs/openapi.json
```

It is the **full** document — `/internal/admin/*` included, meaning kill switches, impersonation and
wallet adjustment — so the gate fails closed in both directions: a wrong token is 401, and *no*
`OPERATOR_TOKEN` configured is **404**, never open docs.

**"Test Request" targets the deployment it was served from.** The committed artifact carries a
`{baseUrl}` template that defaults to `http://localhost:3000`; serving it unchanged would make every
trial request from a deployed page fire at the tester's own laptop and fail in a way that reads as a
broken API. The served copy therefore substitutes the real base url, resolved from configuration
(`PUBLIC_API_BASE_URL`, or `RENDER_EXTERNAL_URL` which Render injects) and never from the request —
behind a proxy the container sees its internal host. The file in git stays hermetic.

What QA needs beyond the token, to exercise rather than only read:

| to call | credential | note |
| --- | --- | --- |
| `/v1/*` | `Authorization: Bearer sk_test_…` | a sandbox key from the dashboard |
| `/internal/*` | `x-internal-token` | `BFF_INTERNAL_TOKEN` — server-side seam, not a customer credential |
| `/internal/admin/*` | `x-operator-token` | same token as the docs gate |
| `/webhooks/*` | `x-webhook-token` | `WEBHOOK_INGRESS_TOKEN`. **Unset means every carrier DLR is 401** and delivery status never advances past `accepted` |

Redlines still hold on that environment: `SMS_PROVIDER=fake`, `sk_test_` keys only, no live payments.
A send there returns a `provider_ref` of `fake-<messageId>`, which is what proves it was the fake
provider and not a carrier.

Locally, prefer `pnpm docs` — no token, no API, no database.

## Authentication

Send application credentials as `Authorization: Bearer sk_test_…` or `sk_live_…`. These are for
trusted servers only and are unrelated to WorkOS dashboard sessions.

## Compatibility

Path-versioned under `/v1`. Additive fields are compatible. Removing or renaming a field, changing
its meaning, or tightening accepted input requires a migration plan and a new compatible surface
rather than silently breaking v1.

## Known gaps

Measured from the artifact, not asserted: **140 operations. All 133 that return a body carry a
response schema**, the remaining 7 being `204` deletes.

That denominator is the point. It previously read "129 of 129", counted from the endpoints that HAD
schemas — a figure that cannot report anything but complete. Counted honestly it was 129 of 133, and
the four gaps were `GET /health`, `GET /health/readyz`, `GET /docs` and `GET /docs/openapi.json`.
One of those is the endpoint the deploy pipeline polls as its evidence a release is live, and
another is the document describing every other contract. Both now have one.

62 of 79 writes carry a request contract, and the 17 without are body-less by design — seven
`DELETE`s, the five provider webhook ingress routes (which carry Meta's, Paystack's, Arkesel's and
SNS's payloads, not ours), and `clone` / `archive` / `mark-read` / `template-sync` / `replay`.

The two recorded `TODO(contract)` defects are gone: `POST /v1/api-keys` no longer parses its body
with an unchecked cast, and `POST /v1/flows` resolves its discriminated union through a contract.

A missing schema is visible in the document rather than implying the endpoint takes or returns
nothing. No shape is ever hand-written to fill a gap — that is the failure this pipeline replaced.
