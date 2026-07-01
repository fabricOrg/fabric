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
