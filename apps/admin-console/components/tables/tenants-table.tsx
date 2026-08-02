"use client";

import type { ListTenantsResponse, TenantSummaryDto } from "@app/contracts";
import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { DataTable } from "@app/ui/components/ui/data-table";
import { Input } from "@app/ui/components/ui/input";
import { LoadMore } from "@app/ui/components/ui/load-more";
import {
  StatusBadge as SharedStatusBadge,
  type StatusTone,
} from "@app/ui/components/ui/status-badge";
import { useCursorPage } from "@app/ui/hooks/use-cursor-page";
import { formatUtcDate } from "@app/ui/lib/datetime";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2, ChevronRight, SearchX } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toastApiError } from "@/lib/error-toast";

async function fetchTenantsPage(cursor: string): Promise<ListTenantsResponse> {
  const response = await fetch(
    `/api/admin/tenants?cursor=${encodeURIComponent(cursor)}`,
    { cache: "no-store" },
  );
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw payload;
  return payload as ListTenantsResponse;
}

type Status = TenantSummaryDto["status"];

const STATUS: Record<Status, { tone: StatusTone; label: string }> = {
  active: { tone: "success", label: "Active" },
  suspended: { tone: "warning", label: "Suspended" },
  // An account soft-closes, so `closed` is a resting state rather than a failure.
  closed: { tone: "neutral", label: "Closed" },
};

function StatusBadge({ status }: { status: Status }) {
  const { tone, label } = STATUS[status];
  return <SharedStatusBadge tone={tone} label={label} />;
}

const columns: ColumnDef<TenantSummaryDto>[] = [
  {
    id: "tenant",
    header: "Tenant",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-medium">{row.original.name}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.slug}
        </span>
      </div>
    ),
  },
  {
    id: "plan",
    header: "Plan",
    cell: ({ row }) => (
      <span className="capitalize text-muted-foreground">
        {row.original.plan}
      </span>
    ),
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    id: "region",
    header: "Region",
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.data_region}</span>
    ),
  },
  {
    id: "created",
    header: "Created",
    cell: ({ row }) => (
      <span className="text-muted-foreground tabular-nums">
        {formatUtcDate(row.original.created_at)}
      </span>
    ),
  },
  {
    id: "manage",
    header: () => <span className="sr-only">Manage</span>,
    cell: ({ row }) => (
      <div className="text-right">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/tenants/${row.original.slug}`}>
            Manage
            <ChevronRight data-icon="inline-end" />
          </Link>
        </Button>
      </div>
    ),
  },
];

export function TenantsTable({
  tenants,
  nextCursor,
  loadError,
}: {
  tenants: readonly TenantSummaryDto[];
  nextCursor: string | null;
  loadError: boolean;
}) {
  const [query, setQuery] = useState("");
  const { items, hasMore, loading, loadMore } = useCursorPage(
    tenants,
    nextCursor,
    async (cursor) => {
      const page = await fetchTenantsPage(cursor);
      return { items: page.tenants, next_cursor: page.next_cursor };
    },
    toastApiError,
  );

  // Search filters the rows loaded so far (control-plane scale). "Load more" pulls older pages.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (t) =>
        t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q),
    );
  }, [items, query]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>All tenants</CardTitle>
        <CardDescription>Search and review every organisation.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tenants…"
          className="sm:max-w-xs"
          aria-label="Search tenants"
        />
        <DataTable
          columns={columns}
          data={filtered as TenantSummaryDto[]}
          ariaLabel="Tenants"
          error={
            loadError
              ? {
                  title: "Couldn't load tenants",
                  message:
                    "The tenant directory is temporarily unavailable. Refresh the page to try again.",
                }
              : undefined
          }
          emptyState={
            items.length === 0
              ? {
                  title: "No tenants yet",
                  description:
                    "Create the first customer organisation to begin onboarding.",
                  icon: <Building2 />,
                }
              : {
                  title: "No matching tenants",
                  description: `No tenants match “${query}”. Try a different name or slug.`,
                  icon: <SearchX />,
                }
          }
        />
        {!loadError ? (
          <>
            {/* Only when not narrowing by a search term — "Load more" pages the full list. */}
            {query.trim() === "" ? (
              <LoadMore
                hasMore={hasMore}
                loading={loading}
                onLoadMore={loadMore}
              />
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
