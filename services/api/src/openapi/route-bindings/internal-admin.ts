import {
  createProposalRequestSchema,
  decideProposalRequestSchema,
  decideSenderRequestSchema,
  goLiveRequestSchema,
  inviteStaffRequestSchema,
  listAdminSendersResponseSchema,
  listAuditResponseSchema,
  listKillSwitchesResponseSchema,
  listProposalsResponseSchema,
  listStaffResponseSchema,
  listTenantsResponseSchema,
  pageQuery,
  provisionTenantRequestSchema,
  provisionTenantResponseSchema,
  setSenderCarrierStatusRequestSchema,
  startImpersonationRequestSchema,
  stopImpersonationRequestSchema,
  toggleKillSwitchRequestSchema,
  updateSandboxAllowancePolicySchema,
  updateStaffRequestSchema,
  updateTenantStatusRequestSchema,
} from "@app/contracts";
import type { RouteBindings } from "../route-binding.types.js";

/**
 * Staff control plane, all behind `BffTokenGuard` and reached only through the admin console.
 * Every entry is `internal` — these never reach the published artifact.
 *
 * Every write here references its zod request contract, and every list endpoint its response
 * contract. What remains untyped are the single-resource writes — decide a proposal, toggle a kill
 * switch, invite a staff user — which return service-layer objects with no exported DTO. That was
 * established by exhausting the exports of `@app/contracts`, not assumed: there is genuinely
 * nothing to point at. Closing it means giving those handlers response contracts, and the absent
 * schema is the honest marker that they lack one.
 */
export const INTERNAL_ADMIN_BINDINGS: RouteBindings = {
  // ---- Tenants -----------------------------------------------------------------------------
  "GET /internal/admin/tenants": {
    summary: "List tenants",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
    response: listTenantsResponseSchema,
    query: pageQuery,
  },
  "POST /internal/admin/tenants": {
    summary: "Provision a tenant",
    description:
      "Enterprise manual provisioning. Self-serve signup does not come through here.",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
    successStatus: 201,
    request: provisionTenantRequestSchema,
    response: provisionTenantResponseSchema,
  },
  "PATCH /internal/admin/tenants/:id": {
    summary: "Update tenant status",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
    request: updateTenantStatusRequestSchema,
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
    request: updateSandboxAllowancePolicySchema,
  },

  // ---- Audit, kill switches, impersonation -------------------------------------------------
  "GET /internal/admin/audit": {
    summary: "List audit events",
    description:
      "Append-only. The provisioner holds SELECT and INSERT but no UPDATE or DELETE.",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
    response: listAuditResponseSchema,
    query: pageQuery,
  },
  "GET /internal/admin/kill-switches": {
    summary: "List kill switches",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
    response: listKillSwitchesResponseSchema,
  },
  "POST /internal/admin/kill-switches/:key": {
    summary: "Toggle a kill switch",
    description:
      "Gates risky operations platform-wide. Checked before the side effect, read through a short " +
      "TTL cache so a store outage cannot fail every send.",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
    request: toggleKillSwitchRequestSchema,
  },
  "POST /internal/admin/impersonation/start": {
    summary: "Start an impersonation session",
    description: "Time-boxed and audited.",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
    request: startImpersonationRequestSchema,
  },
  "POST /internal/admin/impersonation/stop": {
    summary: "Stop an impersonation session",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
    request: stopImpersonationRequestSchema,
  },

  // ---- Maker-checker proposals -------------------------------------------------------------
  "GET /internal/admin/proposals": {
    summary: "List proposals",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
    response: listProposalsResponseSchema,
  },
  "POST /internal/admin/proposals": {
    summary: "File a proposal",
    description:
      "Maker half of maker-checker; the filer cannot also decide it.",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
    successStatus: 201,
    request: createProposalRequestSchema,
  },
  "POST /internal/admin/proposals/:id/decide": {
    summary: "Approve or reject a proposal",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
    request: decideProposalRequestSchema,
  },
  "POST /internal/admin/proposals/go-live": {
    summary: "Request go-live for a tenant",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
    request: goLiveRequestSchema,
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
    response: listStaffResponseSchema,
    query: pageQuery,
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
    request: inviteStaffRequestSchema,
  },
  "PATCH /internal/admin/staff/:id": {
    summary: "Update a staff user",
    tags: ["Identity"],
    visibility: "internal",
    security: ["bffInternal"],
    request: updateStaffRequestSchema,
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
    response: listAdminSendersResponseSchema,
  },
  "POST /internal/admin/senders/:id/decide": {
    summary: "Approve or reject a sender ID",
    tags: ["Sender IDs"],
    visibility: "internal",
    security: ["bffInternal"],
    request: decideSenderRequestSchema,
  },
  "POST /internal/admin/senders/:id/carrier-status": {
    summary: "Record a carrier registration outcome",
    tags: ["Sender IDs"],
    visibility: "internal",
    security: ["bffInternal"],
    request: setSenderCarrierStatusRequestSchema,
  },
};
