# Admin-console test coverage

## Now (vitest, node env, `pnpm --filter @app/admin-console test`)
- `lib/server/origin.spec.ts` — the CSRF origin gate on every BFF mutation route
- `lib/money.spec.ts` — exact bigint money formatting
- `components/forms/create-tenant-dialog.schema.spec.ts` — provisioning form validation + slugify

## Deliberate follow-up (NOT yet covered — needs tooling this app does not carry)
- **Component/interaction** (jsdom + @testing-library): row-action guards (owner-immutable,
  last-admin), dialog submit flows, table empty/error states.
- **Playwright staff-console smoke**: login → tenants → kill-switch toggle → audit, across viewports.

Tracked as A2 in team/product-owner/ARCHITECTURE-FIXES-PROMPT.md; not silently skipped.
