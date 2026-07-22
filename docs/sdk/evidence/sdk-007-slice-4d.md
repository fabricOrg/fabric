# SDK-007 Slice 4d Report

## Files Changed

- `services/api/src/email/managed-email-parity.integration.spec.ts` - adds managed Email preview/send parity and same-key concurrency coverage.
- `services/api/src/email/managed-email-negatives.integration.spec.ts` - adds send-boundary renderer/schema negative tests with no-side-effect assertions.
- `services/api/src/email/email-dispatch-recovery.spec.ts` - adds kill-switch recheck fail-open unit coverage.
- `docs/sdk/evidence/sdk-007-slice-4d.md` - records slice evidence and gate results.

## Gates

- PASS: `pnpm.cmd --filter @app/api --filter @app/domain typecheck` - 2 packages.
- PASS: `pnpm.cmd --filter @app/api exec vitest run src/email/email-dispatch-recovery.spec.ts --reporter verbose` - 1 file, 3 tests.
- PASS: `.env-loaded pnpm.cmd --filter @app/api exec vitest run --config vitest.integration.config.ts src/email/managed-email-parity.integration.spec.ts src/email/managed-email-negatives.integration.spec.ts --reporter verbose` - 2 files, 5 tests.
- PASS: `pnpm.cmd guard:file-length` - 11 source roots.
- PASS: `pnpm.cmd guard:browser-safe` - 1 package.
- PASS: `pnpm.cmd biome check --write services/api/src/email/managed-email-parity.integration.spec.ts services/api/src/email/managed-email-negatives.integration.spec.ts services/api/src/email/email-dispatch-recovery.spec.ts` - 3 files.
- PARTIAL/FAIL: `.env-loaded pnpm.cmd --filter @app/api exec vitest run --config vitest.integration.config.ts src/messages/managed-email.integration.spec.ts src/email/managed-email-dispatch.integration.spec.ts src/email/managed-email-recovery.integration.spec.ts src/messages/managed-messages.integration.spec.ts --reporter verbose` - `src/messages/managed-messages.integration.spec.ts` passed 10 tests, then the run failed after local Postgres stopped accepting connections (`ECONNREFUSED` on `::1:5432` and `127.0.0.1:5432`). Docker inspection was blocked by local Docker Desktop permissions.
- FAIL/BLOCKED: `.env-loaded pnpm.cmd --filter @app/api exec vitest run --config vitest.integration.config.ts src/messages/managed-email.integration.spec.ts --reporter verbose` - 1 file, 7 tests skipped, suite failed in `beforeAll` because local Postgres was still unreachable (`ECONNREFUSED`).

## Defects

- No managed Email production-code defect was uncovered by the new tests. The existing-spec rerun failure is a local DB availability blocker, not a money-path assertion failure.

## Redlines

- No production code changed.
- Nothing committed or pushed; `dev` was not touched.
- No deploy, terraform, publish, live send, live payment, or production DB action was run.
