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

## Testing it end to end

Three layers, cheapest first. Only the third proves the document matches reality.

**1. Is the committed artifact current?**

```bash
pnpm openapi:check      # fails if a route is unbound, orphaned, or the file is stale
```
Runs inside `pnpm validate`, so it gates every push. Needs no database and no running API.

**2. Read it in a browser.**

```bash
OPERATOR_TOKEN=<a-real-secret> pnpm --filter @app/api dev
```
Open `http://localhost:3000/docs`. The browser prompts for HTTP Basic — any username, the operator
token as the password. You get the FULL document, `/internal/*` included. With no `OPERATOR_TOKEN`
set the endpoint answers 404, not 401: a disabled docs surface should be indistinguishable from one
that was never built.

**3. Call every documented endpoint against a running API.**

```bash
pnpm --filter @app/api contracts:probe
```
This is the one that matters. Response validation is strict outside production, so a
`500 response_contract_violation` means the published schema disagrees with the real payload — the
class of defect that let a dead `servers` url and a missing WhatsApp channel sit in the artifact for
weeks. The probe exits non-zero on a contract violation ONLY; a 404 for a row this environment lacks,
or a 401 for a credential it was not given, says nothing about the specification.

It reads credentials and path-parameter values from the environment, so nothing is baked in:

| variable | for |
| --- | --- |
| `PROBE_BASE_URL` | defaults to `http://localhost:3000` |
| `PROBE_TENANT_TOKEN` | `/v1/*` routes — mint one via `POST /internal/identity/tenant-token` |
| `PROBE_API_KEY` | an application-scoped `sk_*` key; email, WhatsApp and batches require one |
| `BFF_INTERNAL_TOKEN` · `OPERATOR_TOKEN` · `WEBHOOK_INGRESS_TOKEN` | the other credential paths |
| `PROBE_IDS` | JSON map of path-parameter values (`tenantId`, `messageId`, `emailId`, …) |

A route whose parameters cannot be resolved is reported SKIPPED rather than called with an invented
id — a 404 from a made-up value looks like a contract failure and is not one.

**CLAUDE.md §12 makes all three a rule**: no endpoint may be consumed anywhere until it is bound,
present in the artifact, and has returned a real 2xx here.

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
