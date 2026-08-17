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

Routes carrying `TODO(contract)` in the binding files are documented for path, verb, auth and intent
but have no body schema attached yet — currently the `/internal/*` surface. They are listed, not
hidden; a missing schema is visible in the document rather than implying the endpoint takes nothing.
