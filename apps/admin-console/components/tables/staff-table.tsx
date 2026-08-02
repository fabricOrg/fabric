"use client";

import type { ListStaffResponse, StaffDto } from "@app/contracts";
import { Avatar, AvatarFallback } from "@app/ui/components/ui/avatar";
import { Badge } from "@app/ui/components/ui/badge";
import { DataTable } from "@app/ui/components/ui/data-table";
import { LoadMore } from "@app/ui/components/ui/load-more";
import { StatusBadge as SharedStatusBadge } from "@app/ui/components/ui/status-badge";
import { useCursorPage } from "@app/ui/hooks/use-cursor-page";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { StaffRowActions } from "@/components/staff-row-actions";
import { toastApiError } from "@/lib/error-toast";

async function fetchStaffPage(cursor: string): Promise<ListStaffResponse> {
  const response = await fetch(
    `/api/admin/staff?cursor=${encodeURIComponent(cursor)}`,
    { cache: "no-store" },
  );
  const payload = (await response.json()) as unknown;
  if (!response.ok) throw payload;
  return payload as ListStaffResponse;
}

type StaffRole = StaffDto["role"];

const ROLE_LABEL: Record<StaffRole, string> = {
  operator: "Operator",
  admin: "Admin",
};

function initials(value: string): string {
  const source = value.trim();
  const parts = source.includes(" ") ? source.split(" ") : source.split("@");
  return parts
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function StatusBadge({ status }: { status: StaffDto["status"] }) {
  const suspended = status === "suspended";
  return (
    <SharedStatusBadge
      tone={suspended ? "warning" : "success"}
      label={suspended ? "Suspended" : "Active"}
    />
  );
}

export function StaffTable({
  staff,
  nextCursor,
  canManage,
  selfId,
}: {
  staff: readonly StaffDto[];
  nextCursor: string | null;
  canManage: boolean;
  selfId: string;
}) {
  const { items, hasMore, loading, loadMore } = useCursorPage(
    staff,
    nextCursor,
    async (cursor) => {
      const page = await fetchStaffPage(cursor);
      return { items: page.staff, next_cursor: page.next_cursor };
    },
    toastApiError,
  );
  const columns = useMemo<ColumnDef<StaffDto>[]>(() => {
    const base: ColumnDef<StaffDto>[] = [
      {
        id: "member",
        header: "Member",
        cell: ({ row }) => {
          const s = row.original;
          return (
            <div className="flex items-center gap-3">
              <Avatar className="size-8">
                <AvatarFallback>{initials(s.name ?? s.email)}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">
                  {s.name ?? s.email}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {s.email}
                </span>
              </div>
            </div>
          );
        },
      },
      {
        id: "role",
        header: "Role",
        cell: ({ row }) => (
          <Badge
            variant={row.original.role === "admin" ? "default" : "secondary"}
          >
            {ROLE_LABEL[row.original.role]}
          </Badge>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: "access",
        header: "Access",
        cell: ({ row }) => (
          <span
            className={
              row.original.bound
                ? "text-xs text-muted-foreground"
                : "text-xs text-warning"
            }
          >
            {row.original.bound ? "Signed in" : "Pending"}
          </span>
        ),
      },
    ];

    if (!canManage) return base;

    return [
      ...base,
      {
        id: "actions",
        header: () => <div className="text-right">Actions</div>,
        cell: ({ row }) => {
          const s = row.original;
          return (
            <div className="text-right">
              {s.staff_user_id === selfId ? (
                <span className="text-xs text-muted-foreground">You</span>
              ) : (
                <StaffRowActions
                  id={s.staff_user_id}
                  label={s.name ?? s.email}
                  role={s.role}
                  status={s.status}
                />
              )}
            </div>
          );
        },
      },
    ];
  }, [canManage, selfId]);

  return (
    <div className="flex flex-col gap-4">
      <DataTable
        columns={columns}
        data={items}
        ariaLabel="Staff members"
        empty="No staff yet."
      />
      <LoadMore hasMore={hasMore} loading={loading} onLoadMore={loadMore} />
    </div>
  );
}
