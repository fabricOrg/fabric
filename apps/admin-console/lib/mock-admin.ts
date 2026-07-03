import type { Money } from "@app/contracts";

/**
 * Mock control-plane data — TODO(BFF): served by the admin-api under staff RBAC + audited reads.
 * Shapes mirror the platform: tenants soft-close (never hard-delete); every consequential change is
 * a maker-checker proposal + an audit entry with before→after.
 */

export type TenantStatus = "active" | "suspended" | "closed";

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: "free" | "growth" | "scale";
  status: TenantStatus;
  balance: Money;
  region: string;
  createdAt: string;
}

export const TENANTS: readonly Tenant[] = [
  {
    id: "acc_kwikgh",
    name: "KwikGH",
    slug: "kwikgh",
    plan: "growth",
    status: "active",
    balance: { currency: "GHS", minor: "120403" },
    region: "gh-accra",
    createdAt: "2026-05-02",
  },
  {
    id: "acc_accramedia",
    name: "Accra Media",
    slug: "accra-media",
    plan: "free",
    status: "active",
    balance: { currency: "GHS", minor: "1500" },
    region: "gh-accra",
    createdAt: "2026-06-11",
  },
  {
    id: "acc_naijasms",
    name: "Naija SMS Co",
    slug: "naija-sms",
    plan: "scale",
    status: "suspended",
    balance: { currency: "NGN", minor: "0" },
    region: "ng-lagos",
    createdAt: "2026-04-20",
  },
  {
    id: "acc_oldco",
    name: "OldCo (closed)",
    slug: "oldco",
    plan: "free",
    status: "closed",
    balance: { currency: "GHS", minor: "0" },
    region: "gh-accra",
    createdAt: "2026-01-08",
  },
];

/** A maker-checker proposal — a sensitive change awaiting a SECOND operator's approval. */
export interface Proposal {
  id: string;
  kind: "wallet_adjustment" | "plan_change" | "refund";
  tenant: string;
  proposedBy: string;
  reason: string;
  before: string;
  after: string;
  at: string;
}

export const PROPOSALS: readonly Proposal[] = [
  {
    id: "mc_8831",
    kind: "wallet_adjustment",
    tenant: "KwikGH",
    proposedBy: "ops/ama",
    reason: "Goodwill credit — carrier outage 07-02",
    before: "GHS 1,204.03",
    after: "GHS 1,254.03",
    at: "2026-07-03 09:12",
  },
  {
    id: "mc_8830",
    kind: "plan_change",
    tenant: "Accra Media",
    proposedBy: "sales/kojo",
    reason: "Upgrade free → growth (signed order)",
    before: "free",
    after: "growth",
    at: "2026-07-03 08:40",
  },
  {
    id: "mc_8829",
    kind: "refund",
    tenant: "Naija SMS Co",
    proposedBy: "support/efua",
    reason: "Duplicate top-up (ref pay_7742)",
    before: "NGN 0.00",
    after: "NGN 5,000.00",
    at: "2026-07-02 17:55",
  },
];

/** An immutable audit entry — every consequential staff action, with before→after + reason. */
export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  target: string;
  before?: string;
  after?: string;
  reason: string;
  at: string;
}

export const AUDIT: readonly AuditEntry[] = [
  {
    id: "au_5521",
    actor: "ops/ama",
    action: "tenant.suspend",
    target: "Naija SMS Co",
    before: "active",
    after: "suspended",
    reason: "Chargeback dispute pending",
    at: "2026-07-03 07:30",
  },
  {
    id: "au_5520",
    actor: "ops/kwame",
    action: "impersonation.start",
    target: "KwikGH",
    reason: "Debug failed DLR reconciliation (ticket #4821)",
    at: "2026-07-03 06:58",
  },
  {
    id: "au_5519",
    actor: "ops/ama",
    action: "killswitch.sending.pause",
    target: "Accra Media",
    before: "on",
    after: "off",
    reason: "Spam complaint investigation",
    at: "2026-07-02 22:10",
  },
  {
    id: "au_5518",
    actor: "ops/kwame",
    action: "wallet.adjust.approve",
    target: "KwikGH",
    before: "GHS 1,150.00",
    after: "GHS 1,204.03",
    reason: "Maker-checker mc_8801 approved",
    at: "2026-07-02 15:02",
  },
];

export interface KillSwitch {
  id: string;
  label: string;
  scope: string;
  description: string;
  enabled: boolean;
}

export const KILL_SWITCHES: readonly KillSwitch[] = [
  {
    id: "ks_platform_send",
    label: "Platform SMS sending",
    scope: "platform",
    description: "Master switch — pauses ALL outbound SMS across every tenant.",
    enabled: true,
  },
  {
    id: "ks_provider_at",
    label: "Africa's Talking provider",
    scope: "provider",
    description:
      "Route sends away from Africa's Talking (failover / incident).",
    enabled: true,
  },
  {
    id: "ks_tenant_naija",
    label: "Naija SMS Co — sending",
    scope: "tenant",
    description: "Pause this tenant's sends (under investigation).",
    enabled: false,
  },
];
