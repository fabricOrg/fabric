import {
  type ProvisionTenantResponse,
  provisionTenantResponseSchema,
} from "@app/contracts";
import { type NextRequest, NextResponse } from "next/server";
import { readAdminSessionWithRefresh } from "@/lib/server/auth";
import { requireTrustedOrigin } from "@/lib/server/origin";
import { listTenants, TenantApiError } from "@/lib/server/tenants-client";

/** Keyset page of tenants for the "Load more" control (a read — no origin/CSRF gate). */
export async function GET(request: NextRequest) {
  if (!(await readAdminSessionWithRefresh())) {
    return NextResponse.json(
      {
        error: {
          type: "auth_error",
          code: "invalid_session",
          message: "Staff sign-in required.",
        },
      },
      { status: 401 },
    );
  }
  const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
  try {
    return NextResponse.json(await listTenants(cursor ? { cursor } : {}));
  } catch (error) {
    const status = error instanceof TenantApiError ? error.status : 502;
    return NextResponse.json(
      {
        error: {
          type: "api_error",
          code: "tenants_unavailable",
          message: "Tenant service is unavailable right now.",
        },
      },
      { status },
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

// Market region (UI) → data-residency region (accounts.dataRegion). All West/East-Africa markets
// currently sit on af-south-1; revisit when we add residency zones.
const DATA_REGION: Record<string, string> = {
  "gh-accra": "af-south-1",
  "ng-lagos": "af-south-1",
  "ke-nairobi": "af-south-1",
};

function fail(message: string, status = 422) {
  return NextResponse.json(
    { error: { type: "validation_error", code: "invalid_request", message } },
    { status },
  );
}

export async function POST(request: NextRequest) {
  const denied = requireTrustedOrigin(request);
  if (denied) return denied;
  // Staff-session gated — this triggers a real WorkOS org create + invite; never reachable without
  // an authenticated staff session (the page guard alone doesn't protect this directly-hittable route).
  if (!(await readAdminSessionWithRefresh())) {
    return NextResponse.json(
      {
        error: {
          type: "auth_error",
          code: "invalid_session",
          message: "Staff sign-in required.",
        },
      },
      { status: 401 },
    );
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return fail("Malformed request body.", 400);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const region = typeof body.region === "string" ? body.region : "";
  const plan = typeof body.plan === "string" ? body.plan : "";
  const adminEmail =
    typeof body.adminEmail === "string" ? body.adminEmail.trim() : "";

  if (name.length < 2) return fail("Business name is required.");
  if (!/^[a-z0-9-]{2,}$/.test(slug))
    return fail("Slug must be lower-case letters, numbers and dashes.");
  if (!REGIONS.has(region)) return fail("Choose a valid region.");
  if (!PLANS.has(plan)) return fail("Choose a valid plan.");
  if (!EMAIL.test(adminEmail)) return fail("Enter a valid admin email.");

  const dataRegion = DATA_REGION[region] ?? "af-south-1";
  const apiBaseUrl = process.env.API_BASE_URL;
  const bffToken = process.env.BFF_INTERNAL_TOKEN;
  if (!apiBaseUrl || !bffToken) {
    return fail("Provisioning isn't configured for this environment.", 500);
  }

  // Delegate to the staff-guarded api endpoint (external write: WorkOS org create + invite).
  try {
    const response = await fetch(
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
    );
    const payload = (await response.json()) as unknown;
    if (!response.ok)
      return NextResponse.json(payload, { status: response.status });
    // Pass the contract shape straight through — no fabricated balance/createdAt (the earlier
    // wrapper invented a `balance:0` + today's date the backend never returned). The Tenants
    // page re-fetches the real list on success anyway.
    const provisioned: ProvisionTenantResponse =
      provisionTenantResponseSchema.parse(payload);
    return NextResponse.json(provisioned, { status: 201 });
  } catch {
    return fail("Provisioning service is unavailable. Try again shortly.", 502);
  }
}
