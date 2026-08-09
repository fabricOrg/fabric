import type { KillSwitchDto } from "@app/contracts";
import type { killSwitches, NewKillSwitch } from "@app/db";

/**
 * The PLATFORM circuit breakers we ship with (`tenant_id` NULL). Seeded on read (additive). All
 * start operational except the signup gate. Tenant overrides are never seeded — they are created by
 * an operator pausing one workspace.
 */
export const CATALOG: NewKillSwitch[] = [
  {
    key: "platform.sms_sending",
    label: "Platform SMS sending",
    description: "Master switch — pauses ALL outbound SMS across every tenant.",
    scope: "platform",
  },
  {
    key: "platform.email_sending",
    label: "Platform email sending",
    description:
      "Master switch — pauses ALL outbound email across every tenant.",
    scope: "platform",
  },
  {
    key: "platform.whatsapp_sending",
    label: "Platform WhatsApp sending",
    description:
      "Master switch - pauses ALL outbound WhatsApp across every tenant.",
    scope: "platform",
  },
  {
    key: "platform.payments",
    label: "Payments",
    description:
      "Pause wallet top-ups and charges (collections/disbursements).",
    scope: "payments",
  },
  // PI-6 self-serve signup gate. Seeded OFF (enabled:false) — unlike every other switch, which
  // starts operational — because opening the platform to stranger sign-ups is safe only once the
  // abuse/fraud controls (Phase-5 ops) exist. An operator turns it on from the admin console; the
  // provisioning check FAILS CLOSED (see signupEnabled()). OFF = new accounts denied; existing
  // users unaffected.
  {
    key: "platform.signup",
    label: "Self-serve signup",
    description:
      "Allow a verified stranger to self-provision a workspace on first sign-in. Keep OFF until abuse/fraud controls are in place — OFF denies new accounts; existing users are unaffected.",
    scope: "platform",
    enabled: false,
  },
  // One switch per provider that ACTUALLY has an adapter — the SmsService gate reads
  // `provider.<slug>` before every send (finding 9). Africa's Talking + Hubtel were seeded here
  // with no adapter behind them: dead switches that advertised "route sends away" but did nothing.
  // They're dropped (and cleaned from seeded DBs by migration 0033) until an adapter exists —
  // adding a real provider re-adds its switch here.
  {
    key: "provider.arkesel-sms",
    label: "Arkesel provider",
    description:
      "Halt sends via Arkesel (incident). No failover target yet, so this refuses Arkesel sends rather than rerouting.",
    scope: "provider",
  },
  {
    key: "provider.meta-cloud",
    label: "Meta Cloud provider",
    description:
      "Halt WhatsApp sends via Meta Cloud. No failover target yet, so this refuses Meta sends rather than rerouting.",
    scope: "provider",
  },
];

/**
 * Switches that CANNOT be scoped to a workspace. `platform.signup` gates a stranger self-provisioning
 * their FIRST workspace — there is no tenant to scope it to at the moment it is read, so an override
 * would sit in the table looking meaningful while `signupEnabled()` never consults it. Rejected by
 * the service and hidden by the console, rather than left as a button that quietly does nothing.
 */
export const PLATFORM_ONLY_KEYS = new Set<string>(["platform.signup"]);

/** Provider keys with a live adapter — anything else `provider.*` in the table is pruned. */
export const LIVE_PROVIDER_KEYS = CATALOG.filter(
  (s) => s.scope === "provider",
).map((s) => s.key);

export type KillSwitchRow = typeof killSwitches.$inferSelect;

/**
 * `platformPaused` is the state of the NULL-tenant row for the same key, so an override can say
 * plainly that it is currently moot: precedence is platform OR tenant, and a workspace resumed here
 * still sends nothing while the platform breaker is down.
 */
export function toDto(
  row: KillSwitchRow,
  tenantName: string | null,
  platformPaused: boolean,
): KillSwitchDto {
  return {
    key: row.key,
    tenant_id: row.tenantId,
    tenant_name: tenantName,
    tenant_scopable: !PLATFORM_ONLY_KEYS.has(row.key),
    label: row.label,
    description: row.description,
    scope: row.scope,
    enabled: row.enabled,
    overridden_by_platform:
      row.tenantId !== null && row.enabled && platformPaused,
    last_reason: row.lastReason,
    last_actor_email: row.lastActorEmail,
    updated_at: row.updatedAt.toISOString(),
  };
}
