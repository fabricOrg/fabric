"use client";

import type { ApiKey } from "@app/contracts";
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
import { KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toastApiError } from "@/lib/error-toast";

function formatTimestamp(value: string | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ApiKeysTable({ keys }: { keys: readonly ApiKey[] }) {
  const router = useRouter();
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [revoking, setRevoking] = useState(false);

  async function confirmRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      const response = await fetch(
        `/api/api-keys/${encodeURIComponent(revokeTarget.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        toastApiError(await response.json().catch(() => null));
        return;
      }
      setRevokeTarget(null);
      router.refresh(); // re-SSR: the key now shows as revoked
    } catch {
      toastApiError(null);
    } finally {
      setRevoking(false);
    }
  }

  const columns: ColumnDef<ApiKey>[] = [
    {
      accessorKey: "name",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Name" />
      ),
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name || "—"}</span>
      ),
    },
    {
      accessorKey: "prefix",
      header: "Key",
      cell: ({ row }) => (
        <span className="font-mono text-sm text-muted-foreground">
          {row.original.prefix}
        </span>
      ),
    },
    {
      id: "scopes",
      header: "Scopes",
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.scopes.map((s) => (
            <Badge key={s} variant="outline" className="font-mono text-xs">
              {s}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      accessorKey: "lastUsedAt",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Last used" />
      ),
      cell: ({ row }) => (
        <span className="tabular-nums text-muted-foreground">
          {formatTimestamp(row.original.lastUsedAt)}
        </span>
      ),
    },
    {
      accessorKey: "expiresAt",
      header: "Expires",
      cell: ({ row }) => (
        <span className="tabular-nums text-muted-foreground">
          {formatTimestamp(row.original.expiresAt ?? null)}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      cell: ({ row }) =>
        row.original.status === "active" ? (
          <Badge className="border-transparent bg-success/12 text-success">
            Active
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Revoked
          </Badge>
        ),
    },
    {
      id: "actions",
      header: () => null,
      cell: ({ row }) =>
        row.original.status === "active" ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => setRevokeTarget(row.original)}
          >
            Revoke
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        data={[...keys]}
        ariaLabel="API keys"
        emptyState={{
          icon: <KeyRound />,
          title: "No API keys yet",
          description:
            "Create a key to start calling the Fabric API from this environment.",
        }}
      />

      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(o) => !o && setRevokeTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Revoke “{revokeTarget?.name || "this key"}”?
            </DialogTitle>
            <DialogDescription>
              This immediately stops all requests using this key. It can&apos;t
              be undone — create a new key to restore access.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmRevoke}
              disabled={revoking}
            >
              {revoking ? "Revoking…" : "Revoke key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
