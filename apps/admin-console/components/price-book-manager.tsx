"use client";

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
import { useState } from "react";
import { PriceBookEditorDialog } from "./price-book-editor-dialog";

/** Format minor units as a readable amount (e.g. GHS 3 pesewas → "GHS 0.03"). */
function formatMinor(minor: string, currency: string): string {
  const n = Number(minor);
  if (!Number.isFinite(n)) return `${currency} ${minor}`;
  return `${currency} ${(n / 100).toFixed(2)}`;
}

export function PriceBookManager({
  books,
  canManage,
}: {
  books: readonly PriceBookDto[];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState<PriceBookDto | null>(null);
  const [open, setOpen] = useState(false);

  function openEditor(book: PriceBookDto | null) {
    setEditing(book);
    setOpen(true);
  }

  return (
    <>
      {canManage ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => openEditor(null)}>
            <Plus className="size-4" />
            New price book
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        {books.map((book) => (
          <Card key={book.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
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
            <CardContent className="flex items-end justify-between gap-4">
              <div className="flex flex-wrap gap-2">
                {book.rates.length === 0 ? (
                  <span className="text-sm text-muted-foreground">
                    No rates configured.
                  </span>
                ) : (
                  book.rates.map((rate) => (
                    <Badge
                      key={`${rate.channel}:${rate.currency}`}
                      variant="outline"
                      className="font-normal"
                    >
                      <span className="uppercase">{rate.channel}</span>
                      <span className="mx-1 text-muted-foreground">·</span>
                      {formatMinor(rate.unit_price_minor, rate.currency)}
                      <span className="ml-1 text-muted-foreground">
                        {rate.channel === "sms" ? "/segment" : "/send"}
                      </span>
                    </Badge>
                  ))
                )}
              </div>
              {canManage ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openEditor(book)}
                >
                  Edit
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      {canManage ? (
        <PriceBookEditorDialog
          // Remount on target change so the form re-seeds from the selected book.
          key={editing?.id ?? "new"}
          open={open}
          onOpenChange={setOpen}
          book={editing}
        />
      ) : null}
    </>
  );
}
