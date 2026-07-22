# SDK-007 Slice 4a-ii Report

## Files Changed

- `packages/contracts/src/email.ts` - exports the shared email address schema.
- `packages/contracts/src/managed-messages.ts` - widens managed send request/response channel and recipient contracts.
- `packages/contracts/src/message-definition-content.ts` - adds optional authored email `from`.
- `packages/db/src/schema/managed-messages.ts` - adds unique email-message attempt index.
- `packages/db/migrations/0085_managed_email_attempt_unique.sql` - raw SQL for the new unique index.
- `packages/db/migrations/meta/_journal.json` and `0085_snapshot.json` - registers the migration and snapshot.
- `services/api/src/email/email.service.ts` - adds managed email accept/persist path.
- `services/api/src/messages/message-preview.service.ts` - threads `email_from` through preview output.
- `services/api/src/messages/managed-messages.service.ts` - dispatches managed sends by preview channel.
- `services/api/src/messages/managed-messages-reads.ts` - resolves email deliveries via email message/vault read.
- `services/api/src/messages/messages.module.ts` - imports `EmailModule`.
- `services/api/src/messages/messages.controller.spec.ts` - updates preview mock shape.
- `services/api/src/messages/managed-messages.spec-harness.ts` - adds email release seeding and email cleanup.
- `services/api/src/messages/managed-email.integration.spec.ts` - covers managed email accept/persist scenarios.

## Gates

- PASS: `pnpm --filter @app/contracts build`.
- PASS: `pnpm --filter @app/contracts --filter @app/domain --filter @app/db --filter @app/sms-engine --filter @app/api typecheck` - 5 packages.
- PASS: `pnpm --filter @app/contracts --filter @app/domain --filter @app/api test` - 43 files, 308 tests.
- PASS: `pnpm --filter @app/api exec vitest run --config vitest.integration.config.ts src/messages/managed-email.integration.spec.ts src/messages/managed-messages.integration.spec.ts src/email/email.integration.spec.ts --reporter verbose` - 3 files, 22 tests.
- PASS: `pnpm biome check --write ...changed files...` - fixed formatting in 4 files.
- PASS: `pnpm --filter @app/db db:assert:drift`.
- FAIL: `pnpm db:migrate` exits 1 locally with only Drizzle `undefined`/lifecycle output. The `0085` DDL was validated/applied directly against local Postgres, and `db:assert:drift` passes.
- FAIL: `pnpm --filter @app/api test:integration` - unrelated local tier failures: missing `DATABASE_URL_PROVISIONER` for senders, wallet statement expected 9750n but got 0n, and retention fixture violates existing channel/message check.

## Ambiguity Resolved

- `emailVariantContent.from` was not present in this checkout despite the task saying it already existed; added it as optional in the contract and threaded it to preview.
- Email attempt DTO `message_id` is returned as `null`; the channel plus DB `email_message_id` is the per-channel reference.

## Not Verified

- Full API integration tier green locally, for the unrelated failures above.
- Drizzle `db:migrate` command green locally, because it fails opaquely after local migration state; the actual index exists and drift assertion is green.

## Redlines

- Nothing committed.
- Nothing pushed.
- No deploy, terraform, live send, live payment, npm publish, or production DB touched.
