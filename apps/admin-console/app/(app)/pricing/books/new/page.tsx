import {
  PageHeader,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import { notFound } from "next/navigation";
import { PriceBookForm } from "@/components/forms/price-book-form";
import { requireAdminSession } from "@/lib/server/auth";

export default async function NewPriceBookPage() {
  const session = await requireAdminSession();
  // Authorization is re-checked here, not inherited from the list page hiding the link: a route is
  // reachable by typing it.
  if (!session.permissions.includes("staff:write")) notFound();

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitle>New price book</PageHeaderTitle>
          <PageHeaderDescription>
            A named set of per-channel, per-currency unit prices. Accounts
            resolve to their assigned book, or the mode default.
          </PageHeaderDescription>
        </PageHeaderHeading>
      </PageHeader>

      <PriceBookForm book={null} />
    </div>
  );
}
