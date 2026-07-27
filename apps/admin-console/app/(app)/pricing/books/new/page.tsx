import Link from "next/link";
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
      <div className="flex flex-col gap-1">
        <Link
          href="/pricing"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Pricing
        </Link>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          New price book
        </h1>
        <p className="text-sm text-muted-foreground">
          A named set of per-channel, per-currency unit prices. Accounts resolve
          to their assigned book, or the mode default.
        </p>
      </div>

      <PriceBookForm book={null} />
    </div>
  );
}
