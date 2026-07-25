// Barrel: the single schema entry point drizzle.config.ts points at.
// As we add domains (wallet, sms…), re-export them here.
export type {
  ApplicationId,
  DekId,
  EnvironmentId,
  MinorUnits,
  SubjectId,
  TenantId,
  UserId,
} from "./_shared.js";
export * from "./api-idempotency.js";
export * from "./api-keys.js";
export * from "./applications.js";
export * from "./audit.js";
export * from "./auto-topup.js";
export * from "./email.js";
export * from "./flows.js";
export * from "./identity.js";
export * from "./integrations.js";
export * from "./kill-switches.js";
export * from "./managed-messages.js";
export * from "./message-batches.js";
export * from "./message-definitions.js";
export * from "./opt-outs.js";
export * from "./payment-authorizations.js";
export * from "./payments.js";
export * from "./price-books.js";
export * from "./privacy.js";
export * from "./proposals.js";
export * from "./request-logs.js";
export * from "./senders.js";
export * from "./sms.js";
export * from "./sms-templates.js";
export * from "./tokens.js";
export * from "./verify.js";
export * from "./virtual-phone.js";
export * from "./wallet.js";
export * from "./webhooks.js";
