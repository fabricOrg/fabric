// @app/contracts — the SHARED API surface: zod request/response schemas, error codes, and the
// types inferred from them. WHY a dedicated package: it's the one place cross-domain DTOs live, so
// services and (later) the SDK/dashboard validate against the SAME definitions — no drift, strong
// types at every boundary. Business logic NEVER lives here; only shapes + validation.
//
// Convention: define a zod schema, then infer the type from it (one source of truth):
//   export const sendSmsRequest = z.object({ to: z.string(), body: z.string().min(1) });
//   export type SendSmsRequest = z.infer<typeof sendSmsRequest>;
//
// Domains add their schemas as files here (e.g. ./sms.ts, ./wallet.ts) and re-export below.

// Admin control-plane DTOs — ops-provisioned tenant onboarding (WorkOS org + account + invite).
export * from "./admin.js";
// Workspace -> Application -> Environment hierarchy (ADR-0004). Scoped resources ref an environment.
export * from "./applications.js";
// Audit log — append-only record of consequential staff actions.
export * from "./audit.js";
export * from "./commercial-offers.js";
export * from "./definition-catalog.js";
// Dev-portal DTOs (F8.6/F2.3) — API keys, webhook endpoints, request logs.
export * from "./dev-portal.js";
export * from "./email.js";
// F8.3 error model — shared error envelope + browser-safe parser (produced by services, consumed
// by the frontend). Keep this package zod-only / browser-safe; a CI guard enforces it.
export * from "./errors.js";
// Lighthouse flow (Transactions explorer) — verify → charge → notify, one reconciled record.
export * from "./flows.js";
// Corporate general ledger — the company's books, distinct from the per-tenant wallet subledger.
export * from "./general-ledger.js";
export * from "./identity.js";
// Staff impersonation — time-boxed, audited "view as tenant".
export * from "./impersonation.js";
// Kill switches — platform circuit breakers (pause SMS, disable a provider…).
export * from "./kill-switches.js";
export * from "./managed-messages.js";
// Team-member management — owners/admins invite teammates into their tenant (dashboard).
export * from "./members.js";
export * from "./message-batches.js";
// Managed message definitions (SDK-003) — stable keys, immutable versions, environment releases,
// the portable variable-schema subset. Compatibility logic lives in @app/domain, not here.
export * from "./message-definitions.js";
// Public message preview (messages.preview) — render a released definition, no side effects.
export * from "./message-preview.js";
// F5.3 canonical message-status enum — public API value on responses/webhooks; @app/integrations
// (raw→canonical mapping) and the L5 send pipeline import it from here (one source of truth).
export * from "./message-status.js";
// Money (exact, minor-unit strings) + SMS/wallet response DTOs — consumed by the dashboard/SDK.
export * from "./money.js";
export * from "./opt-outs.js";
export * from "./overview.js";
// Cursor pagination for public list endpoints (page query + next_cursor token).
export * from "./pagination.js";
// Membership permission catalog + baselines + per-user override (admin-managed effective permissions).
export * from "./permissions.js";
// Platform plugin registry (control-plane) — provider instances per capability.
export * from "./plugins.js";
// Price books (ADR-0010) — staff-configurable per-channel/per-currency rate plans, assigned per account.
export * from "./price-books.js";
export * from "./privacy.js";
// Maker-checker — two-person control for consequential tenant changes.
export * from "./proposals.js";
export * from "./request-logs.js";
export * from "./sandbox-allowances.js";
export * from "./senders.js";
export * from "./sms.js";
export * from "./sms-templates.js";
// Wallet top-up (E4) — initiate a provider charge; the webhook credits the ledger.
export * from "./topup.js";
export * from "./verify.js";
export * from "./virtual-phone.js";
export * from "./wallet.js";
export * from "./webhooks.js";
