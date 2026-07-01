# Code Conventions — working agreement

**Adopted 2026-06-04** from the team's `shop-app-v2` codebase (a mature Drizzle modular monolith) so
jojo feels consistent with how the team already builds. We **keep jojo's defined stack — NestJS
(Fastify adapter)** — and port shop-app-v2's *conventions, tooling, and guards* on top. These encode
our five standards: maintainability, scalability, quality, strong type safety, security ([[engineering-values]]).

## Tooling
- **NestJS (Fastify adapter)** for services — our defined framework (unchanged).
- **Biome** = lint + format (one tool; `biome.json`). `pnpm lint` / `pnpm format`.
- **TypeScript strict** (`tsconfig.base.json`): `strict`, `noUnusedLocals/Parameters`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. No `any` (Biome errors on it).
- **pnpm workspaces + Turbo** monorepo: `packages/*` (libs), `services/*` (deployables). Turbo caches
  & parallelizes `typecheck`/`test`/`build` across packages.
- **Vitest** test runner (fast, first-class TS/ESM).
- **Infisical** injects secrets in dev for services (WorkOS keys, provider creds) — not committed
  `.env`; AWS Secrets Manager in cloud. (Pure-local DB creds stay in docker-compose.)
- **Quality gate:** `pnpm verify` = `guard → lint → typecheck → test → build`. Runs in CI and on pre-push.

## Non-negotiable rules (mirror shop-app-v2; align with our design docs)
- **Public APIs expose slugs / reference numbers / approved UUIDs — never raw DB ids.** (Our
  recipient PII already uses `subject_id` surrogates; extend the spirit to all public ids.)
- **Authorization at the boundary.** Enforced in the route/guard layer; frontend gating is UX, never security.
- **Append-only ledgers stay append-only.** Corrections are compensating entries (matches the double-entry ledger, F3.1).
- **Business logic lives in services/domain modules, never inline in route handlers.**
- **Cross-domain communication via service interfaces or `packages/contracts`** — never reach into
  another module's tables. (This *is* our module dependency rule, MODULE-DECOMPOSITION.md.)
- **Tenant safety:** every tenant query runs inside a `SET LOCAL app.tenant_id` transaction as a
  non-owner role (pre-impl B3/B4). No bare `SET`.
- **Source files ≤ 300 lines, test files ≤ 350** (`guard:file-length`). Split before extending.

## TypeScript/JS rules (from `shop-app-v2/docs/engineering/typescript-javascript-rules.md`)
- `??` for fallbacks where `0`/`false`/`""`/`[]` are valid; `||` only when every falsy collapses.
- `===` / `!==` only (except an intentional `value == null` check).
- Prefer early returns; `switch` + exhaustive handling for unions/enums.
- Don't hide a missing required invariant behind `?.` — validate and fail explicitly.
- `const` by default; `unknown` over `any` (narrow before use); `satisfies` to check shape without widening.
- Explicit return types on exported functions when inference isn't obvious.
- Throw **structured errors** (a typed `AppError` with code/status/title/detail — matches F8.3), never raw strings.
- Money is **bigint minor units**, branded (`MinorUnits`); never float.

## Validation
- **zod at every boundary.** Request/response schemas live in `packages/contracts` (the shared DTO +
  error-code package), not inline in handlers. Services receive already-validated, typed objects.

## File & naming conventions
- **kebab-case** files; **PascalCase** types/classes.
- NestJS-native suffixes: `*.module.ts`, `*.controller.ts`, `*.service.ts`
  (`*-query.service.ts` / `*-write.service.ts` for a read/write split), `*.repository.ts`,
  `*.schema.ts`, `*.spec.ts`.
- Layering: **controller → service → repository**; NestJS **constructor DI** (no global singletons).
  Controllers validate input + map responses only; **business logic lives in services** (never controllers).
- Each module exposes its public API via its NestJS module / an `index.ts` barrel; keep internals private.

## Testing
- **Vitest** + AAA structure (`describe`/`it`); `*.spec.ts` co-located or in `test/`.
- A test with every behaviour change; money/PII/tenant paths require tests (PI-1 Definition of Done).
- Tenant isolation gets a **pgTAP / interleaved-pool** test (B3) gating CI.

## Git workflow
- Branch from `dev`: `feature/<ticket>-…` | `fix/<ticket>-…` | `chore/ops-…` (ticket = jojo feature
  id like `f5-2`, epic `e3`, or `ops`). Enforced by `enforce:branch-name`.
- **Conventional Commits** with the ticket as scope: `feat(f5-2): add send pipeline`. Enforced by `enforce:commit-message`.
- Hooks (`.husky/`): pre-commit = branch-name + guard + lint; commit-msg = conventional; pre-push = verify. **Don't skip hooks.**

## What differs from shop-app-v2 (deliberately)
- **Framework:** jojo keeps **NestJS** (shop-app-v2 is plain Fastify). We port its *conventions*, not its framework.
- jojo adds the **two-role + RLS + SET LOCAL** tenant pattern (shop-app-v2's tenancy model differs).
- **Ported from shop-app-v2:** Biome, strict tsconfig, guards, Husky + Conventional Commits, Turbo,
  Infisical (dev secrets), and the `packages/contracts` + `packages/domain` split.
