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
  "wallet:read",
  "applications:read",
  "applications:write",
  "api_keys:read",
  "api_keys:write",
  "request_logs:read",
  // Managed message definitions (SDK-003): author/version drafts vs. release to an environment.
  "definitions:write",
  "definitions:publish",
] as const;
export const membershipPermission = z.enum(membershipPermissions);
export type MembershipPermission = (typeof membershipPermissions)[number];

/** The governance roles that carry a permission baseline (legacy `developer` maps to `member`). */
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

function normalizeRole(role: string): GovernanceRole {
  if (role === "owner" || role === "admin") return role;
  return "member"; // member + legacy `developer`
}

/** Baseline permissions for a role + developer-access flag (used when there is no per-user override). */
export function baselinePermissions(
  role: string,
  developerAccess: boolean,
): MembershipPermission[] {
  const base = ROLE_PERMISSION_BASELINE[normalizeRole(role)];
  const dev = developerAccess ? DEVELOPER_ACCESS_BASELINE : [];
  return [...new Set([...base, ...dev])];
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
