# SDK-007 Slice 4c API Evidence

## Files Changed

- `services/api/src/message-definitions/message-definitions.service.ts` — persisted request channel, enforced channel immutability, generalized locale compatibility, and bound sandbox senders only for SMS.
- `services/api/src/message-definitions/message-definition-dto.ts` — included `latest_version.channel` in version DTOs.
- `services/api/src/message-definitions/message-definition-publish.ts` — required sender binding only when publishing an SMS version.
- `services/api/src/message-definitions/message-definitions.integration.spec.ts` — updated SMS authoring fixtures to include `channel: "sms"` and asserted SMS response channel.
- `services/api/src/message-definitions/message-definitions-email.integration.spec.ts` — added email create, immutable-channel, compatible-version, publish, persisted-row, and response-shape coverage.
- `services/api/src/message-definitions/definition-catalog.integration.spec.ts` — updated SMS fixture to include `channel: "sms"`.
- `services/api/src/messages/managed-messages.spec-harness.ts` — updated managed SMS fixture to include `channel: "sms"`.
- `services/api/src/messages/message-preview.integration.spec.ts` — updated preview SMS fixture to include `channel: "sms"`.

Pre-existing dirty contract files were not modified by this slice: `packages/contracts/src/message-definition-locale.ts`, `packages/contracts/src/message-definitions.ts`.

## Gates

- PASS — `pnpm.cmd --filter @app/contracts --filter @app/domain --filter @app/api typecheck` (`@app/contracts`, `@app/domain`, `@app/api` all passed).
- PASS — `pnpm.cmd --filter @app/api test -- message-definitions.controller.spec.ts` (Vitest ran the API unit suite: 30 files, 158 tests passed).
- PASS — `pnpm.cmd --dir services/api exec vitest run --config vitest.integration.config.ts src/message-definitions/message-definitions.integration.spec.ts src/message-definitions/message-definitions-email.integration.spec.ts` with `.env` loaded (2 files, 10 tests passed).
- FAIL — `pnpm.cmd guard:file-length` due to `packages/contracts/src/message-definitions.ts` at 328 lines over the 300-line source limit. This file is outside the slice edit scope and was already dirty.
- PASS — `pnpm.cmd guard:browser-safe`.
- PASS — `pnpm.cmd --filter @fabric-messaging/sdk openapi:generate` (wrote `docs/api/openapi.json` and `packages/sdk/openapi.json`; no tracked diff remained).
- PASS — `pnpm.cmd --filter @fabric-messaging/sdk openapi:check`.
- PASS — `pnpm.cmd biome check --write` on changed API/OpenAPI files (10 files checked, 2 formatted).

## Ambiguity Resolved

- Publish was not actually channel-agnostic: it required a sender binding for every version. The API now checks the selected version row and requires sender binding only for SMS, allowing email sandbox publish with no SMS binding.
- `@app/contracts` resolved through ignored `packages/contracts/dist`; I regenerated the ignored contracts build output locally so API typecheck used the already-present source contracts without editing contract source.

## Unverifiable

- `guard:file-length` cannot be made green without editing `packages/contracts`, which this task explicitly forbids.

## Redlines

- No live sends, deploys, Terraform, publish-to-registry, production DB access, commit, push, or `dev` branch changes.
- `apps/dashboard` was not modified.
