// Barrel: the single schema entry point drizzle.config.ts points at.
// As we add domains (wallet, sms…), re-export them here.
export * from "./identity.js";
export * from "./privacy.js";
export * from "./sms.js";
export * from "./wallet.js";
