import { type NextRequest, NextResponse } from "next/server";

/**
 * Mock tenant-provisioning BFF.
 * TODO(BFF): replace with a staff-guarded call to POST /internal/admin/tenants in services/api:
 *   1) workos.organizations.createOrganization({ name })       -> org_…
 *   2) insert accounts row { …, workos_organization_id: org_… } in a tx
 *   3) workos.userManagement.sendInvitation({ email, organizationId, roleSlug: 'admin' })
 *   + emit an immutable audit entry. See docs/PI-3/ORG-PROVISIONING.md.
 */

const REGIONS = new Set(["gh-accra", "ng-lagos", "ke-nairobi"]);
const PLANS = new Set(["free", "growth", "scale"]);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(message: string, status = 422) {
  return NextResponse.json(
    { error: { type: "validation_error", code: "invalid_request", message } },
    { status },
  );
}

export async function POST(request: NextRequest) {
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

  const id = crypto.randomUUID();
  const tenant = {
    id,
    name,
    slug,
    plan,
    status: "active" as const,
    balance: { currency: "GHS" as const, minor: "0" },
    region,
    createdAt: new Date().toISOString().slice(0, 10),
  };

  // Mock: a real WorkOS org id arrives from step 1 above.
  return NextResponse.json(
    {
      tenant,
      workosOrganizationId: `org_mock_${id.slice(0, 8)}`,
      invitedEmail: adminEmail,
    },
    { status: 201 },
  );
}
