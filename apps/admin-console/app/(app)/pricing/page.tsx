import type { PriceBookDto } from "@app/contracts";
import { PriceBookManager } from "@/components/price-book-manager";
import { requireAdminSession } from "@/lib/server/auth";
import {
  listPriceBooks,
  PriceBookApiError,
} from "@/lib/server/price-book-client";

export default async function PricingPage() {
  const session = await requireAdminSession();
  const canManage = session.permissions.includes("staff:write");

  let books: PriceBookDto[] = [];
  let loadError = false;
  try {
    books = (await listPriceBooks()).books;
  } catch (error) {
    loadError = error instanceof PriceBookApiError || error instanceof Error;
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Pricing
        </h1>
        <p className="text-sm text-muted-foreground">
          Rate plans priced per channel and currency. Accounts resolve to their
          assigned book, or the mode default. Every edit is audited.
        </p>
      </div>

      {loadError ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Couldn&apos;t load price books right now. Try again shortly.
        </p>
      ) : (
        <PriceBookManager books={books} canManage={canManage} />
      )}
    </div>
  );
}
