"use client";

import type { TenantSummaryDto } from "@app/contracts";
import { Badge } from "@app/ui/components/ui/badge";
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
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

type Status = TenantSummaryDto["status"];

const STATUS: Record<Status, string> = {
  active: "border-transparent bg-success/12 text-success",
  suspended: "border-transparent bg-warning/15 text-warning",
  closed: "border-transparent bg-muted text-muted-foreground",
};

function StatusBadge({ status }: { status: Status }) {
  return (
    <Badge variant="outline" className={STATUS[status]}>
      {status[0]?.toUpperCase()}
      {status.slice(1)}
    </Badge>
  );
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
        {row.original.created_at.slice(0, 10)}
      </span>
    ),
  },
  {
    id: "manage",
    header: () => <span className="sr-only">Manage</span>,
    cell: ({ row }) => (
      <div className="text-right">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/tenants/${row.original.tenant_id}`}>
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
  loadError,
}: {
  tenants: readonly TenantSummaryDto[];
  loadError: boolean;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter(
      (t) =>
        t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q),
    );
  }, [tenants, query]);

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
        {loadError ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Couldn&apos;t load tenants right now. Try again shortly.
          </p>
        ) : (
          <DataTable
            columns={columns}
            data={filtered as TenantSummaryDto[]}
            ariaLabel="Tenants"
            empty={
              tenants.length === 0
                ? "No tenants yet."
                : "No tenants match this search."
            }
          />
        )}
      </CardContent>
    </Card>
  );
}
