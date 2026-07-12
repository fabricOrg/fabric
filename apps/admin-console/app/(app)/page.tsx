import type { TenantSummaryDto } from "@app/contracts";
import { PageContainer } from "@app/ui/components/ui/app-shell";
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
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
    <PageContainer>
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitle>Tenants</PageHeaderTitle>
          <PageHeaderDescription>
            Every customer organisation on Fabric. Accounts soft-close — never
            hard-delete.
          </PageHeaderDescription>
        </PageHeaderHeading>
        <PageHeaderActions>
          <NewTenantButton />
        </PageHeaderActions>
      </PageHeader>

      <TenantsTable
        tenants={tenants}
        nextCursor={nextCursor}
        loadError={loadError}
      />
    </PageContainer>
  );
}
