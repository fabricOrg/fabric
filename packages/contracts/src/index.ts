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

// F8.3 error model — shared error envelope + browser-safe parser (produced by services, consumed
// by the frontend). Keep this package zod-only / browser-safe; a CI guard enforces it.
export * from "./errors.js";

// F5.3 canonical message-status enum — public API value on responses/webhooks; @app/integrations
// (raw→canonical mapping) and the L5 send pipeline import it from here (one source of truth).
export * from "./message-status.js";

// Money (exact, minor-unit strings) + SMS/wallet response DTOs — consumed by the dashboard/SDK.
export * from "./money.js";
export * from "./sms.js";
export * from "./wallet.js";
