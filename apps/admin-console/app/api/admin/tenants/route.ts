import {
  type ProvisionTenantResponse,
  provisionTenantResponseSchema,
  unwrapEnvelope,
} from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import {
  API_EXTERNAL_WRITE_TIMEOUT_MS,
  apiFetch,
} from "@/lib/server/api-fetch";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import {
  bffFailure,
  bffInvalidRequest,
  bffUnauthorized,
  bffUnprocessable,
} from "@/lib/server/bff-error";
import { requireTrustedOrigin } from "@/lib/server/origin";
import { listTenants, TenantApiError } from "@/lib/server/tenants-client";

/** Keyset page of tenants for the "Load more" control (a read — no origin/CSRF gate). */
export async function GET(request: NextRequest) {
  if (!(await readAdminSessionWithRefresh())) {
    return bffUnauthorized("invalid_session", "Staff sign-in required.");
  }
  const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
  try {
    return NextResponse.json(await listTenants(cursor ? { cursor } : {}));
  } catch (error) {
    const status = error instanceof TenantApiError ? error.status : 502;
    return bffFailure(
      "tenants_unavailable",
      "Tenant service is unavailable right now.",
      status,
    );
  }
}

/**
 * Tenant-provisioning BFF → the real staff endpoint POST /internal/admin/tenants (WorkOS org →
 * account → first-admin invite). See docs/PI-3/ORG-PROVISIONING.md.
 *
 * NOTE: the real call is an external write (creates a WorkOS org + sends an invite email). No offline
 * mock — a provisioning that "succeeds" without creating anything an identity can log into is worse
 * than a clear "not configured" error.
 */

const REGIONS = new Set(["gh-accra", "ng-lagos", "ke-nairobi"]);
const PLANS = new Set(["free", "growth", "scale"]);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Market region (UI) → deployed data region. Residency zones can replace this single-region map.
const DATA_REGION: Record<string, string> = {
  "gh-accra": "eu-west-1",
  "ng-lagos": "eu-west-1",
  "ke-nairobi": "eu-west-1",
};

export async function POST(request: NextRequest) {
  const denied = requireTrustedOrigin(request);
  if (denied) return denied;
  // Staff-session gated — this triggers a real WorkOS org create + invite; never reachable without
  // an authenticated staff session (the page guard alone doesn't protect this directly-hittable route).
  if (!(await readAdminSessionWithRefresh())) {
    return bffUnauthorized("invalid_session", "Staff sign-in required.");
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bffInvalidRequest("invalid_request", "Malformed request body.");
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const region = typeof body.region === "string" ? body.region : "";
  const plan = typeof body.plan === "string" ? body.plan : "";
  const adminEmail =
    typeof body.adminEmail === "string" ? body.adminEmail.trim() : "";

  if (name.length < 2)
    return bffUnprocessable("invalid_request", "Business name is required.");
  if (!/^[a-z0-9-]{2,}$/.test(slug))
    return bffUnprocessable(
      "invalid_request",
      "Slug must be lower-case letters, numbers and dashes.",
    );
  if (!REGIONS.has(region))
    return bffUnprocessable("invalid_request", "Choose a valid region.");
  if (!PLANS.has(plan))
    return bffUnprocessable("invalid_request", "Choose a valid plan.");
  if (!EMAIL.test(adminEmail))
    return bffUnprocessable("invalid_request", "Enter a valid admin email.");

  const dataRegion = DATA_REGION[region] ?? "eu-west-1";
  const apiBaseUrl = process.env.API_BASE_URL;
  const bffToken = process.env.BFF_INTERNAL_TOKEN;
  if (!apiBaseUrl || !bffToken) {
    return bffFailure(
      "invalid_request",
      "Provisioning isn't configured for this environment.",
    );
  }

  // Delegate to the staff-guarded api endpoint (external write: WorkOS org create + invite). The
  // longest write in this console and the least idempotent, so it takes the external-write budget:
  // a deadline that fires here leaves an organization created and an invitation sent.
  try {
    const response = await apiFetch(
      new URL("/internal/admin/tenants", apiBaseUrl),
      {
        method: "POST",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          "x-bff-token": bffToken,
        },
        body: JSON.stringify({ name, slug, plan, adminEmail, dataRegion }),
      },
      API_EXTERNAL_WRITE_TIMEOUT_MS,
    );
    const payload = (await response.json()) as unknown;
    if (!response.ok)
      return NextResponse.json(payload, { status: response.status });
    // Pass the contract shape straight through — no fabricated balance/createdAt (the earlier
    // wrapper invented a `balance:0` + today's date the backend never returned). The Tenants
    // page re-fetches the real list on success anyway.
    const provisioned: ProvisionTenantResponse =
      provisionTenantResponseSchema.parse(unwrapEnvelope(payload));
    return NextResponse.json(provisioned, { status: 201 });
  } catch {
    return bffFailure(
      "invalid_request",
      "Provisioning service is unavailable. Try again shortly.",
      502,
    );
  }
}
