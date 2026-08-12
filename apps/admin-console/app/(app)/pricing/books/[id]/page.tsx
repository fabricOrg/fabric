import {
  PageHeader,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import { notFound } from "next/navigation";
import { SetBreadcrumbTitle } from "@/components/breadcrumb-title";
import { PriceBookForm } from "@/components/forms/price-book-form";
import { requireAdminSession } from "@/lib/server/auth";
import { listPriceBooks } from "@/lib/server/price-book-client";

export default async function EditPriceBookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAdminSession();
  // Authorization is re-checked here, not inherited from the list page hiding the link: a route is
  // reachable by typing it.
  if (!session.permissions.includes("staff:write")) notFound();

  const { id } = await params;
  // Read from the list rather than a dedicated endpoint: there is no GET-by-id on the admin API,
  // and the set of books is small enough that adding one would be more surface than it saves.
  const { books } = await listPriceBooks();
  const book = books.find((candidate) => candidate.id === id);
  if (!book) notFound();

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader>
        <PageHeaderHeading>
          <SetBreadcrumbTitle title={book.name} />
          <PageHeaderTitle>{book.name}</PageHeaderTitle>
          <PageHeaderDescription>
            Editing this book reprices every account assigned to it. Token lots
            already bought keep the price locked in at purchase.
          </PageHeaderDescription>
        </PageHeaderHeading>
      </PageHeader>

      <PriceBookForm book={book} />
    </div>
  );
}
