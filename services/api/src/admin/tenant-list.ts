import type { ListTenantsResponse } from "@app/contracts";
import {
  accounts,
  clampLimit,
  decodeCursor,
  encodeCursor,
  keysetWhere,
  offerCatalogAssignments,
  type ProvisioningDb,
  takePage,
} from "@app/db";
import { desc, eq } from "drizzle-orm";

/**
 * The staff control-plane tenant list. Extracted from `TenantProvisioningService` so the read query —
 * which now joins the commercial-catalog assignment and will keep accumulating columns as staff
 * surfaces grow — does not crowd out the provisioning WRITES it sat beside.
 *
 * Cross-tenant by design: runs on the provisioning connection, keyset-paginated on
 * (created_at DESC, id DESC).
 */
export async function listTenantsPage(
  provisioning: ProvisioningDb,
  opts: { limit?: number; cursor?: string } = {},
): Promise<ListTenantsResponse> {
  const pageSize = clampLimit(opts.limit);
  const decoded = opts.cursor ? decodeCursor(opts.cursor) : null;
  const keyset = keysetWhere(
    accounts.createdAt,
    accounts.id,
    "desc",
    decoded
      ? { primaryValue: new Date(decoded.primary), id: decoded.id }
      : null,
  );
  const rows = await provisioning.db
    .select({
      tenant_id: accounts.id,
      name: accounts.name,
      slug: accounts.slug,
      plan: accounts.plan,
      status: accounts.status,
      data_region: accounts.dataRegion,
      workos_organization_id: accounts.workosOrganizationId,
      price_book_id: accounts.priceBookId,
      offer_catalog_id: offerCatalogAssignments.priceBookId,
      billing_currency: accounts.billingCurrency,
      created_at: accounts.createdAt,
    })
    .from(accounts)
    // LEFT join: most workspaces have no negotiated prepaid catalog, and an absent row means the
    // default catalog — not a missing account.
    .leftJoin(
      offerCatalogAssignments,
      eq(offerCatalogAssignments.tenantId, accounts.id),
    )
    .where(keyset)
    .orderBy(desc(accounts.createdAt), desc(accounts.id))
    .limit(pageSize + 1);
  const { page, nextCursor } = takePage(rows, pageSize, (row) =>
    encodeCursor(row.created_at.toISOString(), row.tenant_id),
  );
  return {
    tenants: page.map((row) => ({
      ...row,
      created_at: row.created_at.toISOString(),
    })),
    next_cursor: nextCursor,
  };
}
