# Scalability hardening

This is the execution record for the July 2026 code-level scalability review. The review used
runtime code, schemas, migrations, tests, build configuration, and deployment configuration as its
sources. It did not use the existing architecture documentation as evidence.

## Target

Fabric remains a modular monolith, but HTTP serving, asynchronous work, and scheduled work must be
independently scalable. Financial triggers must be durable and concurrency-safe. Customer metrics
must remain correct after list endpoints paginate. High-volume telemetry must be bounded, and code
quality gates must cover every maintained application.

## Priorities

| Priority | Finding | Completion evidence | Status |
| --- | --- | --- | --- |
| P0 | Concurrent sends can trigger multiple auto-top-up charges, and the trigger can be lost when the API process exits. | Database uniqueness, durable scheduled claiming, provider-reference recovery, and real-Postgres concurrency tests. | Implemented; DB run pending |
| P0 | Dashboard month-to-date metrics are calculated from only the first message page and latest 100 ledger entries. | Authoritative aggregate API, shared contract, and tests beyond both old limits. | Implemented; DB run pending |
| P1 | API-key touches and request-log inserts amplify writes without bounded backpressure. | Five-minute key-touch coalescing; 100-row/250ms bounded log batches; focused tests. | Complete |
| P1 | Every API replica also starts queue workers, cron jobs, and webhook delivery. | `api`/`worker`/`scheduler` role gates using the same image; deployment services still required. | In progress |
| P1 | SMS batches prepare up to 100 items serially before existing queued delivery. | Bounded ten-item preparation; provider delivery remains on the durable send queue. | Complete |
| P1 | Database readiness is used as container liveness. | Dependency-free `/health` + `/healthz`; database-aware `/health/readyz`. | Complete |
| P2 | Webhook materialization, metrics, and network fan-out are insufficiently bounded. | 1,000-pair materialization cap, concurrency 10, global metrics every five ticks. | Complete |
| P2 | Turbo is configured but unused, and the file-length guard excludes frontend applications. | Turbo-backed root tasks and all application sources covered by the guard. | Complete |
| P2 | Docker dependency layers are invalidated by every source change. | Lockfile-first `pnpm fetch` layers in all runtime Dockerfiles. | Complete |
| P2 | The dashboard tenant-token cache has no eviction or single-flight minting. | 1,000-tenant cap, expiry pruning, and per-tenant single-flight minting. | Complete |
| P2 | Provisioning sends the retired `af-south-1` region despite the locked `eu-west-1` runtime region. | Contract/schema/UI/Terraform defaults corrected with a data migration. | Complete |
| P3 | Astro reports duplicate `/404` routes and warns that this becomes a future hard failure. | Starlight default route disabled in favor of the branded route. | Complete |

## Delivery rules

- Protect financial and tenancy invariants with database constraints, not process-local checks.
- Use expand/contract migrations and keep migrations compatible with the currently deployed code.
- Do not split the domain into microservices. Runtime roles may use separate ECS services while
  sharing the same source, contracts, database, image, and release.
- Do not report aggregates by reading paginated list responses. Aggregate at the source-of-truth
  tables with explicit time windows and lifecycle filters.
- Every asynchronous workflow must prove retry safety, duplicate handling, and crash recovery.
- A completed row requires code, focused tests, full relevant gates, and updated status in this file.

## Verification log

- Baseline `pnpm guard`: passed.
- Baseline `pnpm typecheck`: passed; Astro emitted the duplicate `/404` forward-compatibility warning.
- Full Turbo test graph: 22 tasks passed; API suite includes 202 tests.
- Contracts suite: 76 tests passed; integrations package: 55 tests passed.
- Full Turbo typecheck graph: 22 tasks passed; lint and production build passed.
- Real-Postgres suites could not run because local Docker/Postgres was unavailable.
