import Link from "next/link";
import { notFound } from "next/navigation";
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
      <div className="flex flex-col gap-1">
        <Link
          href="/pricing"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Pricing
        </Link>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          {book.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          Editing this book reprices every account assigned to it. Token lots
          already bought keep the price locked in at purchase.
        </p>
      </div>

      <PriceBookForm book={book} />
    </div>
  );
}
