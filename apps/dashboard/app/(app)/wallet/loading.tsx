import {
  PageHeader,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import { Skeleton } from "@app/ui/components/ui/skeleton";
import { LoadingRows } from "@app/ui/components/ui/states";

/**
 * Route-level fallback. The wallet page awaits five upstream reads (wallet, catalog, credits,
 * purchases, payment method), so without this the whole segment stays blank until the slowest one
 * lands. The heading is real markup, not a skeleton — it is known before any fetch resolves, so
 * shimmering it would be a lie about what is loading.
 */
export default function WalletLoading() {
  return (
    <div className="flex w-full flex-col gap-6" aria-busy="true">
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitle>Wallet &amp; Billing</PageHeaderTitle>
          <PageHeaderDescription>
            Balances, top-ups, and your double-entry transaction history.
          </PageHeaderDescription>
        </PageHeaderHeading>
      </PageHeader>

      <Skeleton className="h-9 w-64" aria-hidden="true" />

      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-44 w-full" aria-hidden="true" />
        <Skeleton className="h-44 w-full" aria-hidden="true" />
      </div>

      <LoadingRows rows={3} />
      <span className="sr-only" role="status">
        Loading wallet
      </span>
    </div>
  );
}
