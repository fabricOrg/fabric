import {
  createApiKeyRequest,
  scopesExceedingPermissions,
} from "@app/contracts";
import { NextResponse } from "next/server";
import { BffError } from "@/lib/server/api-client";
import { createApiKey } from "@/lib/server/api-keys-client";
import {
  readDashboardSession,
  refreshDashboardSession,
} from "@/lib/server/auth";
import {
  bffFailure,
  bffForbidden,
  bffUnauthorized,
  bffUnprocessable,
} from "@/lib/server/bff-error";
import { hasTrustedOrigin } from "@/lib/server/origin";

/**
 * Create an API key. Gated on the `api_keys:write` permission (owner/admin, or a developer-access
 * member) — enforced here for a clean 403, and again in the tenant-token client. The tenant is the
 * session's workspace, never client-supplied; the secret is returned exactly once.
 */
export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return bffForbidden("invalid_origin", "Request rejected.");
  }
  const session =
    (await readDashboardSession()) ?? (await refreshDashboardSession());
  if (!session) {
    return bffUnauthorized("invalid_session", "Sign in again to continue.");
  }
  if (!session.permissions.includes("api_keys:write")) {
    return bffForbidden(
      "insufficient_permission",
      "You don't have permission to create API keys.",
    );
  }
  try {
    const raw = (await request.json()) as Record<string, unknown>;
    const applicationId =
      typeof raw?.application_id === "string" ? raw.application_id : null;
    const parsed = createApiKeyRequest.safeParse(raw);
    if (!parsed.success || !applicationId) {
      // Name the field. zod's own text is written for a developer reading a stack trace — "Too
      // small: expected number to be >0" told an operator nothing about WHICH input to change, and
      // an error that does not point at its cause is a dead end.
      const issue = parsed.error?.issues[0];
      const field = issue?.path
        .filter((segment) => typeof segment !== "number")
        .join(".");
      return bffUnprocessable(
        "invalid_request",
        !applicationId
          ? "An application is required."
          : issue
            ? `${field ? `${field}: ` : ""}${issue.message}`
            : "Enter a name, environment, and at least one scope.",
      );
    }
    // A key inherits the authority of the person minting it — it must not be a way to acquire more.
    // `api_keys:write` is deliberately held by roles that cannot send (the legacy `developer` is
    // exactly that), so without this a caller who may manage keys could mint one carrying
    // `sms:send` and spend the wallet. The API cannot make this call: a tenant token presents
    // wildcard scopes to it by design, and the membership permissions exist only here.
    const excessive = scopesExceedingPermissions(
      parsed.data.scopes,
      session.permissions,
    );
    if (excessive.length > 0) {
      return bffForbidden(
        "scopes_exceed_permissions",
        `You can't grant a key more access than you have: ${excessive.join(", ")}.`,
      );
    }
    // Keys are scoped to an application-environment (ADR-0004); the id comes from the app-detail page.
    const expiresInDays =
      typeof raw?.expires_in_days === "number"
        ? raw.expires_in_days
        : undefined;
    const result = await createApiKey({
      ...parsed.data,
      applicationId,
      ...(expiresInDays ? { expiresInDays } : {}),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return error instanceof BffError
      ? NextResponse.json(error.payload, { status: error.status })
      : bffFailure("bff_error", "Request failed.");
  }
}
