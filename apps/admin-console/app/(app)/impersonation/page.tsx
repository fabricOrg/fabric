import { ImpersonationForm } from "@/components/forms/impersonation-form";
import { readImpersonationClaim, requireAdminSession } from "@/lib/server/auth";
import { listTenants, TenantApiError } from "@/lib/server/tenants-client";

export default async function ImpersonationPage() {
  await requireAdminSession();
  const claim = await readImpersonationClaim();

  let tenants: { id: string; label: string }[] = [];
  let loadError = false;
  try {
    tenants = (await listTenants()).tenants
      .filter((t) => t.status === "active")
      .map((t) => ({ id: t.tenant_id, label: t.name }));
  } catch (error) {
    loadError = error instanceof TenantApiError || error instanceof Error;
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Impersonation
        </h1>
        <p className="text-sm text-muted-foreground">
          View the product as a tenant for support and debugging. Time-boxed,
          never silent, always audited.
        </p>
      </div>

      {loadError ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Couldn&apos;t load tenants right now. Try again shortly.
        </p>
      ) : (
        <ImpersonationForm tenants={tenants} active={claim !== null} />
      )}
    </div>
  );
}
