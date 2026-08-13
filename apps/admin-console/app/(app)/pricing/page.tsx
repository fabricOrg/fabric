import type { PriceBookDto, ProviderCostRateDto } from "@app/contracts";
import { PageContainer } from "@app/ui/components/ui/app-shell";
import { Card, CardContent } from "@app/ui/components/ui/card";
import {
  PageHeader,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import { PriceBookManager } from "@/components/price-book-manager";
import { ProviderCostManager } from "@/components/provider-cost-manager";
import { requireAdminSession } from "@/lib/server/auth";
import {
  listPriceBooks,
  listProviderCostRates,
  PriceBookApiError,
} from "@/lib/server/price-book-client";

export default async function PricingPage() {
  const session = await requireAdminSession();
  const canManage = session.permissions.includes("staff:write");

  let books: PriceBookDto[] = [];
  let providerCosts: ProviderCostRateDto[] = [];
  let loadError = false;
  try {
    [books, providerCosts] = await Promise.all([
      listPriceBooks().then((result) => result.books),
      listProviderCostRates(),
    ]);
  } catch (error) {
    loadError = error instanceof PriceBookApiError || error instanceof Error;
  }

  return (
    <PageContainer>
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitle>Pricing</PageHeaderTitle>
          <PageHeaderDescription>
            Rate books, provider costs, and prepaid package controls.
          </PageHeaderDescription>
        </PageHeaderHeading>
      </PageHeader>

      <Card>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <PricingSignal
            title="Price books"
            value={loadError ? "-" : books.length}
          />
          <PricingSignal
            title="Provider costs"
            value={loadError ? "-" : providerCosts.length}
          />
          <PricingSignal
            title="Can manage"
            value={canManage ? "Yes" : "Read-only"}
          />
        </CardContent>
      </Card>

      {loadError ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Couldn&apos;t load price books right now. Try again shortly.
        </p>
      ) : (
        <PriceBookManager books={books} canManage={canManage} />
      )}
      {!loadError ? (
        <ProviderCostManager rates={providerCosts} canManage={canManage} />
      ) : null}
    </PageContainer>
  );
}

function PricingSignal({
  title,
  value,
}: {
  title: string;
  value: number | string;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border bg-muted/20 p-4">
      <span className="text-muted-foreground text-sm">{title}</span>
      <span className="font-display text-xl font-semibold tabular-nums">
        {value}
      </span>
    </div>
  );
}
