import type { PriceBookDto } from "@app/contracts";
import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { Plus } from "lucide-react";
import Link from "next/link";
import { PriceBookRates } from "./price-book-rates";

/**
 * The price-book list. A Server Component now: editing moved to its own route, so nothing here
 * holds state — "New" and "Edit" are links, which also gives every book a URL that an audit entry
 * or a support thread can point at.
 */
export function PriceBookManager({
  books,
  canManage,
}: {
  books: readonly PriceBookDto[];
  canManage: boolean;
}) {
  return (
    <>
      {canManage ? (
        <div className="flex justify-end">
          <Button size="sm" asChild>
            <Link href="/pricing/books/new">
              <Plus className="size-4" />
              New price book
            </Link>
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        {books.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No price books yet.
          </p>
        ) : null}
        {books.map((book) => (
          <Card key={book.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {book.name}
                <Badge variant="outline" className="text-[10px] uppercase">
                  {book.mode}
                </Badge>
                {book.is_default ? (
                  <Badge className="border-transparent bg-success/12 text-success">
                    Default
                  </Badge>
                ) : null}
                {book.is_public ? (
                  <Badge className="border-transparent bg-primary/12 text-primary">
                    Public
                  </Badge>
                ) : null}
              </CardTitle>
              {book.description ? (
                <CardDescription>{book.description}</CardDescription>
              ) : null}
            </CardHeader>
            <CardContent className="flex flex-wrap items-end justify-between gap-4">
              <PriceBookRates rates={book.rates} />
              {canManage ? (
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/pricing/books/${book.id}`}>
                    Edit
                    <span className="sr-only"> {book.name}</span>
                  </Link>
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
