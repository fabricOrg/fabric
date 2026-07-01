// @app/integrations — the vendor-agnostic provider plugin framework (F5.1 / INTEGRATIONS §3).
// Holds the plugin CONTRACTS + canonical models + status vocabulary that the send pipeline (L5),
// billing, and every provider adapter share. Adapters (FakeProvider, real vendors) live here too.
// Business DECISIONS (rating, commit/refund) belong in @app/domain, not here.

// Re-export the canonical status vocabulary (DEFINED in @app/contracts — browser-safe, a public API
// value) so provider adapters + the L5 pipeline can pull it from @app/integrations alongside the
// plugin contract. Consumer insulation: importing from here doesn't change that the home is
// @app/contracts. SDK/dev-portal/browser code should still import status straight from @app/contracts.
export {
  isTerminalMessageStatus,
  type MessageStatus,
  messageStatus,
  TERMINAL_MESSAGE_STATUSES,
  type TerminalMessageStatus,
} from "@app/contracts";
export * from "./plugin.js";
export * from "./status.js";
