"use client";

import { Button } from "@app/ui/components/ui/button";
import { Skeleton } from "@app/ui/components/ui/skeleton";
import { EmptyState, ErrorState } from "@app/ui/components/ui/states";
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
  emptyState?: {
    title: string;
    description?: string;
    icon?: ReactNode;
    action?: ReactNode;
  };
  loading?: boolean;
  loadingRows?: number;
  error?: { title?: string; message: string; onRetry?: () => void };
  /** Accessible label for the scroll region (WCAG scrollable-region-focusable). */
  ariaLabel?: string;
  onRowClick?: (row: TData) => void;
  /** Per-row accessible label when rows are clickable (e.g. "Open <name>"). */
  rowLabel?: (row: TData) => string;
  /**
   * Stable row identity. Without it TanStack falls back to the array INDEX, so React reuses a row's
   * subtree when the data reorders — an open dialog rendered inside a cell then unmounts, or keeps
   * mounted state while its props switch to a different record. Pass it whenever rows carry an id and
   * the list can change while a row is interactive.
   */
  getRowId?: (row: TData, index: number) => string;
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
  emptyState,
  loading = false,
  loadingRows = 5,
  error,
  ariaLabel,
  onRowClick,
  rowLabel,
  getRowId,
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
    ...(getRowId ? { getRowId } : {}),
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
          {loading ? (
            Array.from({ length: loadingRows }, (_, index) => (
              <TableRow key={`loading-${index}`} aria-hidden="true">
                {columns.map((_, columnIndex) => (
                  <TableCell key={`loading-${index}-${columnIndex}`}>
                    <Skeleton className="h-5 w-full max-w-36" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : error ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="p-4">
                <ErrorState
                  title={error.title ?? "Couldn't load data"}
                  message={error.message}
                  onRetry={error.onRetry}
                />
              </TableCell>
            </TableRow>
          ) : table.getRowModel().rows.length ? (
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
                className="h-48 p-4 text-center text-muted-foreground"
              >
                {emptyState ? (
                  <EmptyState
                    icon={emptyState.icon}
                    title={emptyState.title}
                    description={emptyState.description}
                    action={emptyState.action}
                    className="min-h-36 border-0 p-4 md:p-6"
                  />
                ) : (
                  (empty ?? "No results.")
                )}
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
