import type { RouteBindings } from "../route-binding.types.js";

/**
 * Staff control plane, all behind `BffTokenGuard` and reached only through the admin console.
 * Every entry is `internal` — these never reach the published artifact.
 *
 * Request/response contracts are intentionally absent for now: the public surface was contracted
 * first, and attaching the admin DTOs is queued work. Each route below is DOCUMENTED (path, verb,
 * auth, intent) — only the body shapes are pending, and `TODO(contract)` marks that plainly rather
 * than leaving a reader to assume the endpoint takes nothing.
 */
// TODO(contract): attach request/response zod contracts to every route in this file.
export const INTERNAL_ADMIN_BINDINGS: RouteBindings = {
  // ---- Tenants -----------------------------------------------------------------------------
  "GET /internal/admin/tenants": {
    summary: "List tenants",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
  },
  "POST /internal/admin/tenants": {
    summary: "Provision a tenant",
    description:
      "Enterprise manual provisioning. Self-serve signup does not come through here.",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
    successStatus: 201,
  },
  "PATCH /internal/admin/tenants/:id": {
    summary: "Update tenant status",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
  },
  "GET /internal/admin/tenants/:id/sandbox-allowances": {
    summary: "Retrieve a tenant's sandbox allowances",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
  },
  "PATCH /internal/admin/tenants/:id/sandbox-allowances": {
    summary: "Update a tenant's sandbox allowances",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
  },

  // ---- Audit, kill switches, impersonation -------------------------------------------------
  "GET /internal/admin/audit": {
    summary: "List audit events",
    description:
      "Append-only. The provisioner holds SELECT and INSERT but no UPDATE or DELETE.",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
  },
  "GET /internal/admin/kill-switches": {
    summary: "List kill switches",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
  },
  "POST /internal/admin/kill-switches/:key": {
    summary: "Toggle a kill switch",
    description:
      "Gates risky operations platform-wide. Checked before the side effect, read through a short " +
      "TTL cache so a store outage cannot fail every send.",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
  },
  "POST /internal/admin/impersonation/start": {
    summary: "Start an impersonation session",
    description: "Time-boxed and audited.",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
  },
  "POST /internal/admin/impersonation/stop": {
    summary: "Stop an impersonation session",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
  },

  // ---- Maker-checker proposals -------------------------------------------------------------
  "GET /internal/admin/proposals": {
    summary: "List proposals",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
  },
  "POST /internal/admin/proposals": {
    summary: "File a proposal",
    description:
      "Maker half of maker-checker; the filer cannot also decide it.",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
    successStatus: 201,
  },
  "POST /internal/admin/proposals/:id/decide": {
    summary: "Approve or reject a proposal",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
  },
  "POST /internal/admin/proposals/go-live": {
    summary: "Request go-live for a tenant",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
  },
  "GET /internal/admin/proposals/go-live/status": {
    summary: "Retrieve go-live status",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
  },

  // ---- Staff -------------------------------------------------------------------------------
  "GET /internal/admin/staff": {
    summary: "List staff users",
    tags: ["Identity"],
    visibility: "internal",
    security: ["bffInternal"],
  },
  "POST /internal/admin/staff": {
    summary: "Invite a staff user",
    description:
      "The staff realm is invite-only. A staff user and allowlist row must pre-exist; staff access " +
      "is never created just-in-time at sign-in.",
    tags: ["Identity"],
    visibility: "internal",
    security: ["bffInternal"],
    successStatus: 201,
  },
  "PATCH /internal/admin/staff/:id": {
    summary: "Update a staff user",
    tags: ["Identity"],
    visibility: "internal",
    security: ["bffInternal"],
  },
  "DELETE /internal/admin/staff/:id": {
    summary: "Remove a staff user",
    tags: ["Identity"],
    visibility: "internal",
    security: ["bffInternal"],
    successStatus: 204,
  },

  // ---- Sender review -----------------------------------------------------------------------
  "GET /internal/admin/senders": {
    summary: "List the sender-ID review queue",
    tags: ["Sender IDs"],
    visibility: "internal",
    security: ["bffInternal"],
  },
  "POST /internal/admin/senders/:id/decide": {
    summary: "Approve or reject a sender ID",
    tags: ["Sender IDs"],
    visibility: "internal",
    security: ["bffInternal"],
  },
  "POST /internal/admin/senders/:id/carrier-status": {
    summary: "Record a carrier registration outcome",
    tags: ["Sender IDs"],
    visibility: "internal",
    security: ["bffInternal"],
  },
};
