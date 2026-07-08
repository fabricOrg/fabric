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
// Audit log — append-only record of consequential staff actions.
export * from "./audit.js";
// Dev-portal DTOs (F8.6/F2.3) — API keys, webhook endpoints, request logs.
export * from "./dev-portal.js";
// F8.3 error model — shared error envelope + browser-safe parser (produced by services, consumed
// by the frontend). Keep this package zod-only / browser-safe; a CI guard enforces it.
export * from "./errors.js";
// Lighthouse flow (Transactions explorer) — verify → charge → notify, one reconciled record.
export * from "./flows.js";
export * from "./identity.js";
// Staff impersonation — time-boxed, audited "view as tenant".
export * from "./impersonation.js";
// Kill switches — platform circuit breakers (pause SMS, disable a provider…).
export * from "./kill-switches.js";
// Team-member management — owners/admins invite teammates into their tenant (dashboard).
export * from "./members.js";
// F5.3 canonical message-status enum — public API value on responses/webhooks; @app/integrations
// (raw→canonical mapping) and the L5 send pipeline import it from here (one source of truth).
export * from "./message-status.js";
// Money (exact, minor-unit strings) + SMS/wallet response DTOs — consumed by the dashboard/SDK.
export * from "./money.js";
// Platform plugin registry (control-plane) — provider instances per capability.
export * from "./plugins.js";
// Maker-checker — two-person control for consequential tenant changes.
export * from "./proposals.js";
export * from "./sms.js";
// Wallet top-up (E4) — initiate a provider charge; the webhook credits the ledger.
export * from "./topup.js";
export * from "./wallet.js";
