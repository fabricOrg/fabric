"use client";

import type { ApiKey } from "@app/contracts";
import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import { DataTable } from "@app/ui/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@app/ui/components/ui/dialog";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { toastApiError } from "@/lib/error-toast";
import { revokeApiKey } from "@/lib/mock-api";
import { formatTimestamp } from "@/lib/time";

function EnvBadge({ env }: { env: ApiKey["env"] }) {
  return env === "live" ? (
    <Badge variant="destructive">LIVE</Badge>
  ) : (
    <Badge variant="secondary">TEST</Badge>
  );
}

export function ApiKeysTable({
  keys,
  onRevoked,
}: {
  keys: readonly ApiKey[];
  /** Called after a key is successfully revoked so the parent can update its list. */
  onRevoked: (id: string) => void;
}) {
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [revoking, setRevoking] = useState(false);

  async function confirmRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await revokeApiKey(revokeTarget.id);
      onRevoked(revokeTarget.id);
      setRevokeTarget(null);
    } catch (envelope) {
      toastApiError(envelope);
    } finally {
      setRevoking(false);
    }
  }

  const columns: ColumnDef<ApiKey>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name}</span>
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
      accessorKey: "env",
      header: "Env",
      cell: ({ row }) => <EnvBadge env={row.original.env} />,
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
      header: "Last used",
      cell: ({ row }) => (
        <span className="tabular-nums text-muted-foreground">
          {formatTimestamp(row.original.lastUsedAt)}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) =>
        row.original.status === "active" ? (
          <Badge className="bg-success/12 text-success border-transparent">
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
        empty="No API keys to show."
        className="rounded-lg border"
      />

      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(o) => !o && setRevokeTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke “{revokeTarget?.name}”?</DialogTitle>
            <DialogDescription>
              This immediately stops all requests using this key. It can't be
              undone — you'd create a new key to restore access.
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
