import { z } from "zod";

/**
 * Membership permission catalog + baselines — the SINGLE source of truth shared by the API (session
 * resolution + guards), the dashboard (the permission editor), and tests. A user's EFFECTIVE
 * permissions are an explicit per-user override when set, otherwise the governance-role baseline plus
 * the developer-access add-on. This lets an admin compose an exact permission set per user while
 * unmanaged users keep sensible role defaults ("role as a starting template").
 */

// Every grantable permission. Additive: a new capability appends here and to the relevant baseline.
export const membershipPermissions = [
  "sms:send",
  "sms:read",
  "email:send",
  "email:read",
  "whatsapp:send",
  "whatsapp:read",
  "wallet:read",
  "applications:read",
  "applications:write",
  "api_keys:read",
  "api_keys:write",
  "request_logs:read",
  // Managed messages (SDK-003 runtime): send released definitions by stable key + read their
  // deliveries. Without these in the catalog no membership — not even owner/admin FULL — could ever
  // hold them, so the "Managed deliveries" surface was invisible to everyone.
  "messages:send",
  "messages:read",
  // Managed message definitions (SDK-003): author/version drafts vs. release to an environment.
  "definitions:write",
  "definitions:publish",
] as const;
export const membershipPermission = z.enum(membershipPermissions);
export type MembershipPermission = (typeof membershipPermissions)[number];

/** The governance roles that carry a permission baseline. Legacy `developer` has its own. */
export type GovernanceRole = "owner" | "admin" | "member";

const FULL: readonly MembershipPermission[] = membershipPermissions;

// Role baselines. owner and admin are full today; member is the least-privilege workspace baseline +
// definitions:write (a member may DRAFT content) but NOT definitions:publish (release is owner/admin).
export const ROLE_PERMISSION_BASELINE: Record<
  GovernanceRole,
  readonly MembershipPermission[]
> = {
  owner: FULL,
  admin: FULL,
  member: [
    "sms:send",
    "sms:read",
    "email:send",
    "email:read",
    "whatsapp:send",
    "whatsapp:read",
    "messages:send",
    "messages:read",
    "wallet:read",
    "applications:read",
    "definitions:write",
  ],
};

// Added on top of the role baseline when a membership has developer access (the dev-portal lane).
export const DEVELOPER_ACCESS_BASELINE: readonly MembershipPermission[] = [
  "api_keys:read",
  "api_keys:write",
  "request_logs:read",
];

/**
 * Compatibility baseline for rows that still carry the retired `developer` governance role.
 *
 * Unlike the modern developer-access add-on, that legacy role was the person's COMPLETE authority,
 * so it replaces the member baseline rather than adding to it: API keys, request logs, wallet-read
 * and applications-read, and nothing else.
 *
 * It is NOT uniformly narrower than `member`, and saying so would be wrong: `member` holds no
 * `api_keys:*` at all, so this role is wider on that axis by design — issuing keys is the whole
 * point of it. What it drops is every `*:send`, the message reads and `definitions:write`.
 *
 * That asymmetry has a consequence worth stating where someone will read it: key creation does not
 * currently clamp requested scopes to the actor's own permissions, so `api_keys:write` is an
 * indirect route back to a sending credential. Denying `sms:send` here does not, on its own, deny
 * the ability to send. The clamp belongs in the key-creation path, not in this table.
 * `permissions.spec.ts` pins the set; widening it silently is the failure mode to avoid.
 */
const LEGACY_DEVELOPER_BASELINE: readonly MembershipPermission[] = [
  "wallet:read",
  "applications:read",
  ...DEVELOPER_ACCESS_BASELINE,
];

function normalizeRole(role: string): GovernanceRole {
  if (role === "owner" || role === "admin") return role;
  return "member"; // `developer` is handled before this is reached — see baselinePermissions
}

/** Baseline permissions for a role + developer-access flag (used when there is no per-user override). */
export function baselinePermissions(
  role: string,
  developerAccess: boolean,
): MembershipPermission[] {
  if (role === "developer") return [...LEGACY_DEVELOPER_BASELINE];
  const governanceRole = normalizeRole(role);
  const base = ROLE_PERMISSION_BASELINE[governanceRole];
  // The developer lane is read-only for managed definitions by default. An admin can explicitly
  // restore authoring with a per-user override, but merely enabling API-key/log access must not also
  // grant content-authoring authority.
  const governedBase =
    developerAccess && governanceRole === "member"
      ? base.filter((permission) => permission !== "definitions:write")
      : base;
  const dev = developerAccess ? DEVELOPER_ACCESS_BASELINE : [];
  return [...new Set([...governedBase, ...dev])];
}

/**
 * A membership's EFFECTIVE permissions. A non-null override IS the full set (role becomes a template);
 * otherwise the role + developer-access baseline. Unknown override entries are dropped so a stale or
 * hand-edited row can never smuggle in a permission outside the catalog.
 */
export function effectivePermissions(input: {
  role: string;
  developerAccess: boolean;
  override?: readonly string[] | null;
}): MembershipPermission[] {
  if (input.override != null) {
    const catalog = new Set<string>(membershipPermissions);
    return input.override.filter((p): p is MembershipPermission =>
      catalog.has(p),
    );
  }
  return baselinePermissions(input.role, input.developerAccess);
}

/** Set a user's exact permission set (per-user override). Values are validated against the catalog. */
export const updateMemberPermissionsRequestSchema = z.object({
  permissions: z.array(membershipPermission),
});
export type UpdateMemberPermissionsRequest = z.infer<
  typeof updateMemberPermissionsRequestSchema
>;

/**
 * The membership permission a given API-key scope confers, where one exists.
 *
 * A key is issued BY a person and inherits their authority — it cannot be a way to acquire more of
 * it. `api_keys:write` is held by roles that deliberately cannot send (the legacy `developer` is
 * exactly that), so without this map "mint a key with `sms:send`" is an unguarded escalation from
 * "may manage keys" to "may spend the wallet".
 *
 * Scopes absent from this map (`definitions:read`) have no membership counterpart and are not
 * clamped — refusing what we cannot evaluate would break key creation for everyone rather than
 * secure it. Only scopes we can PROVE the caller lacks are refused.
 */
const SCOPE_REQUIRES_PERMISSION: Readonly<
  Record<string, MembershipPermission>
> = {
  "sms:send": "sms:send",
  "sms:read": "sms:read",
  "email:send": "email:send",
  "email:read": "email:read",
  "whatsapp:send": "whatsapp:send",
  "wallet:read": "wallet:read",
  "request_logs:read": "request_logs:read",
  "api_keys:read": "api_keys:read",
  "api_keys:write": "api_keys:write",
  "messages:send": "messages:send",
  "messages:read": "messages:read",
};

/**
 * Which of `requested` the holder of `permissions` may NOT put on a key. Empty means allowed.
 *
 * Lives in contracts because the check belongs to the BFF: a tenant token presents `scopes: ["*"]`
 * to the API by design (tenant containment only — see the API key guard), so the API cannot make
 * this judgement. The membership permissions exist only on the session.
 */
export function scopesExceedingPermissions(
  requested: readonly string[],
  permissions: readonly string[],
): string[] {
  const held = new Set(permissions);
  return requested.filter((scope) => {
    const required = SCOPE_REQUIRES_PERMISSION[scope];
    return required !== undefined && !held.has(required);
  });
}
