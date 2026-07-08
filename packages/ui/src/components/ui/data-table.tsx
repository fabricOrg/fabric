"use client";

import { Button } from "@app/ui/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@app/ui/components/ui/table";
import { cn } from "@app/ui/lib/utils";
import {
  type Column,
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useState } from "react";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Rendered in a full-width row when there are no rows. */
  empty?: ReactNode;
  /** Accessible label for the scroll region (WCAG scrollable-region-focusable). */
  ariaLabel?: string;
  onRowClick?: (row: TData) => void;
  /** Per-row accessible label when rows are clickable (e.g. "Open <name>"). */
  rowLabel?: (row: TData) => string;
  className?: string;
}

/**
 * Shared table, built on TanStack Table — the single table primitive across all Fabric apps. Columns
 * are declared with `ColumnDef` (headers, cells, sorting) and passed in; this renders header + body,
 * client-side sorting, and a consistent empty state. The scroll region is keyboard-focusable.
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  empty,
  ariaLabel,
  onRowClick,
  rowLabel,
  className,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <section
      className={cn("overflow-x-auto", className)}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable scroll region (WCAG 2.1.1).
      tabIndex={0}
      aria-label={ariaLabel}
    >
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                onClick={
                  onRowClick ? () => onRowClick(row.original) : undefined
                }
                // Clickable rows are keyboard-operable (button semantics + Enter/Space), WCAG 2.1.1.
                {...(onRowClick
                  ? {
                      role: "button",
                      tabIndex: 0,
                      "aria-label": rowLabel?.(row.original),
                      onKeyDown: (e: KeyboardEvent) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onRowClick(row.original);
                        }
                      },
                    }
                  : {})}
                className={onRowClick ? "cursor-pointer" : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-24 text-center text-muted-foreground"
              >
                {empty ?? "No results."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </section>
  );
}

/** Sortable header cell — drop into a column's `header` to get a click-to-sort control + indicator. */
export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: {
  column: Column<TData, TValue>;
  title: string;
  className?: string;
}) {
  if (!column.getCanSort()) {
    return <span className={className}>{title}</span>;
  }
  const sorted = column.getIsSorted();
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("-ml-2 h-8 data-[state=open]:bg-accent", className)}
      onClick={() => column.toggleSorting(sorted === "asc")}
    >
      {title}
      {sorted === "asc" ? (
        <ArrowUp className="ml-1 size-3.5" />
      ) : sorted === "desc" ? (
        <ArrowDown className="ml-1 size-3.5" />
      ) : (
        <ChevronsUpDown className="ml-1 size-3.5 opacity-50" />
      )}
    </Button>
  );
}
