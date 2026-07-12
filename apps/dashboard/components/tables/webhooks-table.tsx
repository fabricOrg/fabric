"use client";

import type { WebhookEndpointDto } from "@app/contracts";
import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import {
  DataTable,
  DataTableColumnHeader,
} from "@app/ui/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@app/ui/components/ui/dialog";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toastApiError } from "@/lib/error-toast";

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function WebhooksTable({
  endpoints,
}: {
  endpoints: readonly WebhookEndpointDto[];
}) {
  const router = useRouter();
  const [deleteTarget, setDeleteTarget] = useState<WebhookEndpointDto | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const response = await fetch(
        `/api/webhooks/${encodeURIComponent(deleteTarget.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        toastApiError(await response.json().catch(() => null));
        return;
      }
      setDeleteTarget(null);
      router.refresh();
    } catch {
      toastApiError(null);
    } finally {
      setDeleting(false);
    }
  }

  const columns: ColumnDef<WebhookEndpointDto>[] = [
    {
      accessorKey: "url",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Endpoint URL" />
      ),
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-mono text-sm">{row.original.url}</span>
          {row.original.description ? (
            <span className="text-xs text-muted-foreground">
              {row.original.description}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: "secret_prefix",
      header: "Signing secret",
      cell: ({ row }) => (
        <span className="font-mono text-sm text-muted-foreground">
          {row.original.secret_prefix}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) =>
        row.original.status === "active" ? (
          <Badge className="border-transparent bg-success/12 text-success">
            Active
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Disabled
          </Badge>
        ),
    },
    {
      accessorKey: "created_at",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Created" />
      ),
      cell: ({ row }) => (
        <span className="tabular-nums text-muted-foreground">
          {formatDate(row.original.created_at)}
        </span>
      ),
    },
    {
      id: "actions",
      header: () => null,
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          onClick={() => setDeleteTarget(row.original)}
        >
          Delete
        </Button>
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        data={[...endpoints]}
        ariaLabel="Webhook endpoints"
        empty="No webhook endpoints yet."
      />

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this endpoint?</DialogTitle>
            <DialogDescription>
              Fabric will stop delivering events to{" "}
              <span className="font-mono">{deleteTarget?.url}</span>. This
              can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete endpoint"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
