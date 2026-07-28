import type { ConfigService } from "@nestjs/config";
import { WorkOS } from "@workos-inc/node";

export const WORKOS_CLIENT = Symbol("WORKOS_CLIENT");
/** The STAFF-realm client — see createStaffWorkosClient for why it is a separate injection. */
export const WORKOS_STAFF_CLIENT = Symbol("WORKOS_STAFF_CLIENT");
export type WorkosClientProvider = () => WorkOS;

export function createWorkosClient(
  config: ConfigService,
): WorkosClientProvider {
  const apiKey = config.get<string>("WORKOS_API_KEY");
  return () => {
    if (!apiKey) throw new Error("WORKOS_API_KEY is required.");
    return new WorkOS(apiKey);
  };
}

/**
 * WorkOS client for the STAFF realm (admin-console invitations).
 *
 * WorkOS API keys are scoped per AuthKit APPLICATION, and an invitation belongs to whichever
 * application's key created it — which is why staff invitations sent with the customer dashboard's
 * key resolve to the DASHBOARD's redirect and land an operator in the customer onboarding wizard.
 * `sendInvitation` accepts no application or redirect argument, so the only lever is the key.
 *
 * Falls back to the customer key when `WORKOS_ADMIN_API_KEY` is unset, which is today's behaviour —
 * so this is inert until the admin application actually has its own key, rather than breaking staff
 * invitations the moment it merges.
 *
 * NOTE: that invitations resolve per-application is inferred, not documented — WorkOS documents no
 * redirect parameter, but every AuthKit application carries its own `userInvitationUrl`, which only
 * makes sense if invitations are application-scoped. The send response returns
 * `accept_invitation_url`, so the first real staff invite sent with the admin key SETTLES it: the
 * URL either points at the console or it does not. Until then the dashboard-side routing fix
 * (ADR-0007 callback) remains the thing that actually guarantees correct landing.
 */
export function createStaffWorkosClient(
  config: ConfigService,
): WorkosClientProvider {
  const adminApiKey = config.get<string>("WORKOS_ADMIN_API_KEY")?.trim();
  const apiKey = adminApiKey || config.get<string>("WORKOS_API_KEY");
  return () => {
    if (!apiKey) throw new Error("WORKOS_API_KEY is required.");
    return new WorkOS(apiKey);
  };
}
