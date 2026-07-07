// Barrel: the single schema entry point drizzle.config.ts points at.
// As we add domains (wallet, sms…), re-export them here.
export type {
  DekId,
  MinorUnits,
  SubjectId,
  TenantId,
  UserId,
} from "./_shared.js";
export * from "./api-keys.js";
export * from "./audit.js";
export * from "./identity.js";
export * from "./integrations.js";
export * from "./kill-switches.js";
export * from "./payments.js";
export * from "./privacy.js";
export * from "./proposals.js";
export * from "./sms.js";
export * from "./wallet.js";
