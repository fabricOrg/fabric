import {
  configurePluginRequestSchema,
  createLiveInstanceRequestSchema,
  createWorkspaceRequestSchema,
  createWorkspaceResponseSchema,
  deliveryMode,
  emailContentResponse,
  emailInboxResponse,
  inviteMemberRequestSchema,
  listMembersResponseSchema,
  mintTenantTokenRequestSchema,
  mintTenantTokenResponseSchema,
  pageQuery,
  pluginActionRequestSchema,
  pluginListResponseSchema,
  resolveStaffSessionRequestSchema,
  resolveStaffSessionResponseSchema,
  resolveUserSessionRequestSchema,
  resolveUserSessionResponseSchema,
  updateMemberPermissionsRequestSchema,
  updateMemberRequestSchema,
  virtualPhoneReply,
  virtualPhoneReplyResponse,
  whatsappMessageListResponse,
  whatsappSendRequest,
  whatsappSendResponse,
  whatsappTemplateListResponse,
} from "@app/contracts";
import type { RouteBindings } from "../route-binding.types.js";

/**
 * Per-tenant BFF surface (`/internal/tenants/*`), identity resolution and the plugin registry.
 * All `internal`: the dashboard's server-side route handlers call these with `BFF_INTERNAL_TOKEN`
 * and supply the tenant id from the authenticated session — never from the client.
 */
export const INTERNAL_PLATFORM_BINDINGS: RouteBindings = {
  // ---- Identity ----------------------------------------------------------------------------
  "POST /internal/identity/session-v2": {
    summary: "Resolve a customer session",
    description:
      "Self-serve provisioning happens here on first login: a verified stranger gets a fresh " +
      "workspace and membership. Authorization is the local membership role, never an IdP claim.",
    tags: ["Identity"],
    visibility: "internal",
    security: ["bffInternal"],
    request: resolveUserSessionRequestSchema,
    response: resolveUserSessionResponseSchema,
  },
  "POST /internal/identity/staff-session": {
    summary: "Resolve a staff session",
    description:
      "Invite-only: no membership means denied, never a just-in-time staff account.",
    tags: ["Identity"],
    visibility: "internal",
    security: ["bffInternal"],
    request: resolveStaffSessionRequestSchema,
    response: resolveStaffSessionResponseSchema,
  },
  "POST /internal/identity/tenant-token": {
    summary: "Mint a short-lived tenant token",
    description:
      "ADR-0003. Scoped to one tenant, minted per request for data-plane calls.",
    tags: ["Identity"],
    visibility: "internal",
    security: ["bffInternal"],
    request: mintTenantTokenRequestSchema,
    response: mintTenantTokenResponseSchema,
  },
  "POST /internal/identity/workspaces": {
    summary: "Create a workspace",
    tags: ["Identity"],
    visibility: "internal",
    security: ["bffInternal"],
    successStatus: 201,
    request: createWorkspaceRequestSchema,
    response: createWorkspaceResponseSchema,
  },

  // ---- Members -----------------------------------------------------------------------------
  "GET /internal/tenants/:tenantId/members": {
    summary: "List workspace members",
    tags: ["Identity"],
    visibility: "internal",
    security: ["bffInternal"],
    response: listMembersResponseSchema,
    query: pageQuery,
  },
  "POST /internal/tenants/:tenantId/members": {
    summary: "Invite a member",
    tags: ["Identity"],
    visibility: "internal",
    security: ["bffInternal"],
    successStatus: 201,
    request: inviteMemberRequestSchema,
  },
  "PATCH /internal/tenants/:tenantId/members/:userId": {
    summary: "Change a member's role",
    description:
      "`developer` is least-privilege: API keys, logs and wallet-read, but not sending or org " +
      "management.",
    tags: ["Identity"],
    visibility: "internal",
    security: ["bffInternal"],
    request: updateMemberRequestSchema,
  },
  "PUT /internal/tenants/:tenantId/members/:userId/permissions": {
    summary: "Set a member's permissions",
    tags: ["Identity"],
    visibility: "internal",
    security: ["bffInternal"],
    request: updateMemberPermissionsRequestSchema,
  },
  "DELETE /internal/tenants/:tenantId/members/:userId": {
    summary: "Remove a member",
    tags: ["Identity"],
    visibility: "internal",
    security: ["bffInternal"],
    successStatus: 204,
  },

  // ---- Inboxes -----------------------------------------------------------------------------
  "GET /internal/tenants/:tenantId/emails": {
    summary: "List a tenant's emails",
    tags: ["Email"],
    visibility: "internal",
    security: ["bffInternal"],
    response: emailInboxResponse,
  },
  "GET /internal/tenants/:tenantId/emails/:id/content": {
    summary: "Retrieve an email's rendered content",
    tags: ["Email"],
    visibility: "internal",
    security: ["bffInternal"],
    errorStatuses: [404],
    response: emailContentResponse,
  },
  "GET /internal/tenants/:tenantId/whatsapp": {
    summary: "List a tenant's WhatsApp conversations",
    tags: ["WhatsApp"],
    visibility: "internal",
    security: ["bffInternal"],
    response: whatsappMessageListResponse,
    query: pageQuery,
  },
  "POST /internal/tenants/:tenantId/whatsapp": {
    summary: "Send a WhatsApp message from the dashboard",
    tags: ["WhatsApp"],
    visibility: "internal",
    security: ["bffInternal"],
    errorStatuses: [402],
    request: whatsappSendRequest,
    response: whatsappSendResponse,
  },
  "GET /internal/tenants/:tenantId/whatsapp/templates": {
    summary: "List available WhatsApp templates",
    description:
      "A cache of Meta's catalog with a stated posture: a fresh negative blocks before money moves, " +
      "an absent or stale row fails OPEN so sync lag is not read as a channel outage.",
    tags: ["WhatsApp"],
    visibility: "internal",
    security: ["bffInternal"],
    response: whatsappTemplateListResponse,
  },

  // ---- Virtual phone (sandbox) -------------------------------------------------------------
  "GET /internal/tenants/:tenantId/messaging-settings": {
    summary: "Retrieve messaging settings",
    tags: ["Sandbox"],
    visibility: "internal",
    security: ["bffInternal"],
  },
  "PATCH /internal/tenants/:tenantId/messaging-settings": {
    summary: "Update messaging settings",
    tags: ["Sandbox"],
    visibility: "internal",
    security: ["bffInternal"],
    request: deliveryMode,
  },
  "GET /internal/tenants/:tenantId/virtual-phone/messages": {
    summary: "List virtual-phone messages",
    description:
      "The sandbox sink. Sandbox exercises rendering, pricing, delivery states and webhooks without " +
      "contacting a carrier.",
    tags: ["Sandbox"],
    visibility: "internal",
    security: ["bffInternal"],
    query: pageQuery,
  },
  "POST /internal/tenants/:tenantId/virtual-phone/inbound": {
    summary: "Simulate an inbound reply",
    tags: ["Sandbox"],
    visibility: "internal",
    security: ["bffInternal"],
    request: virtualPhoneReply,
    response: virtualPhoneReplyResponse,
  },
  "PATCH /internal/tenants/:tenantId/virtual-phone/messages/:messageId/read": {
    summary: "Mark a virtual-phone message read",
    tags: ["Sandbox"],
    visibility: "internal",
    security: ["bffInternal"],
  },
  "DELETE /internal/tenants/:tenantId/virtual-phone/messages": {
    summary: "Clear the virtual-phone inbox",
    tags: ["Sandbox"],
    visibility: "internal",
    security: ["bffInternal"],
    successStatus: 204,
  },

  // ---- Plugin registry ---------------------------------------------------------------------
  "GET /internal/plugins": {
    summary: "List provider plugin instances",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
    response: pluginListResponseSchema,
  },
  "POST /internal/plugins": {
    summary: "Apply plugin catalog configuration",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
    request: pluginActionRequestSchema,
  },
  "POST /internal/plugins/live-instances": {
    summary: "Create a live provider instance",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
    successStatus: 201,
    request: createLiveInstanceRequestSchema,
  },
  "POST /internal/plugins/:id/credentials": {
    summary: "Install provider credentials",
    description:
      "Credentials are sealed with `PLUGIN_MASTER_KEY`. Rotating that key does NOT re-seal existing " +
      "blobs — they must be re-armed, or resolution fails closed.",
    tags: ["Control plane"],
    visibility: "internal",
    security: ["bffInternal"],
    request: configurePluginRequestSchema,
  },
};
