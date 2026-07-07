"use client";

import type { TenantSummaryDto } from "@app/contracts";
import { Badge } from "@app/ui/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { Input } from "@app/ui/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@app/ui/components/ui/table";
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
          <section
            className="overflow-x-auto"
            tabIndex={0}
            aria-label="Tenants"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tenant</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((t) => (
                  <TableRow key={t.tenant_id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{t.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {t.slug}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="capitalize text-muted-foreground">
                      {t.plan}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={t.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {t.data_region}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {t.created_at.slice(0, 10)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {filtered.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                {tenants.length === 0
                  ? "No tenants yet."
                  : "No tenants match this search."}
              </p>
            ) : null}
          </section>
        )}
      </CardContent>
    </Card>
  );
}
