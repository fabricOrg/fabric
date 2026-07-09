import type { TenantSummaryDto } from "@app/contracts";
import { NewTenantButton } from "@/components/new-tenant-button";
import { TenantsTable } from "@/components/tables/tenants-table";
import { requireAdminSession } from "@/lib/server/auth";
import { listTenants, TenantApiError } from "@/lib/server/tenants-client";

export default async function TenantsPage() {
  await requireAdminSession();

  let tenants: TenantSummaryDto[] = [];
  let nextCursor: string | null = null;
  let loadError = false;
  try {
    const page = await listTenants();
    tenants = page.tenants;
    nextCursor = page.next_cursor;
  } catch (error) {
    loadError = error instanceof TenantApiError || error instanceof Error;
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Tenants
          </h1>
          <p className="text-sm text-muted-foreground">
            Every customer organisation on Fabric. Accounts soft-close — never
            hard-delete.
          </p>
        </div>
        <NewTenantButton />
      </div>

      <TenantsTable
        tenants={tenants}
        nextCursor={nextCursor}
        loadError={loadError}
      />
    </div>
  );
}
