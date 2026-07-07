"use client";

import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import {
  DataTable,
  DataTableColumnHeader,
} from "@app/ui/components/ui/data-table";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@app/ui/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@app/ui/components/ui/empty";
import { Input } from "@app/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { cn } from "@app/ui/lib/utils";
import type { ColumnDef } from "@tanstack/react-table";
import { ShieldOff, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AddOptOutDialog } from "@/components/consent/add-opt-out-dialog";
import {
  type OptOut,
  type OptOutScope,
  type OptOutSource,
  removeOptOut,
} from "@/lib/client/consent-api";
import { toastApiError } from "@/lib/error-toast";

const SCOPE_META: Record<OptOutScope, { label: string; cls: string }> = {
  all: { label: "All traffic", cls: "bg-destructive/12 text-destructive" },
  promotional: {
    label: "Promotional",
    cls: "bg-warning/15 text-warning-strong",
  },
};

const SOURCE_LABEL: Record<OptOutSource, string> = {
  "STOP-reply": "STOP reply",
  "2442-registry": "2442 registry",
  manual: "Manual",
};

function ScopeBadge({ scope }: { scope: OptOutScope }) {
  const meta = SCOPE_META[scope];
  return (
    <Badge variant="outline" className={cn("border-transparent", meta.cls)}>
      {meta.label}
    </Badge>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function OptOutTable({
  optOuts,
  onAdd,
  onRemove,
}: {
  optOuts: readonly OptOut[];
  onAdd: (optOut: OptOut) => void;
  onRemove: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<OptOutScope | "all-scopes">("all-scopes");
  const [source, setSource] = useState<OptOutSource | "all-sources">(
    "all-sources",
  );
  const [pending, setPending] = useState<OptOut | null>(null);
  const [removing, setRemoving] = useState(false);

  const columns = useMemo<ColumnDef<OptOut>[]>(
    () => [
      {
        accessorKey: "msisdn",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Number" />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-sm">{row.original.msisdn}</span>
        ),
      },
      {
        id: "scope",
        header: "Scope",
        cell: ({ row }) => <ScopeBadge scope={row.original.scope} />,
      },
      {
        id: "source",
        header: "Source",
        cell: ({ row }) => (
          <Badge
            variant="outline"
            className="border-transparent bg-muted text-muted-foreground"
          >
            {SOURCE_LABEL[row.original.source]}
          </Badge>
        ),
      },
      {
        accessorKey: "at",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Date" />
        ),
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {formatDate(row.original.at)}
          </span>
        ),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <div className="text-right">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPending(row.original)}
              aria-label={`Remove opt-out for ${row.original.msisdn}`}
            >
              <Trash2 />
              Remove
            </Button>
          </div>
        ),
      },
    ],
    [],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return optOuts.filter(
      (o) =>
        (scope === "all-scopes" || o.scope === scope) &&
        (source === "all-sources" || o.source === source) &&
        o.msisdn.toLowerCase().includes(needle),
    );
  }, [optOuts, q, scope, source]);

  async function confirmRemove() {
    if (!pending) return;
    setRemoving(true);
    try {
      await removeOptOut(pending.id);
      onRemove(pending.id);
      toast.success("Opt-out removed", {
        description: `${pending.msisdn} can receive messages again.`,
      });
      setPending(null);
    } catch (payload) {
      toastApiError(payload);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search number…"
          className="font-mono sm:max-w-xs"
          aria-label="Search opted-out number"
          inputMode="tel"
        />
        <Select
          value={scope}
          onValueChange={(v) => setScope(v as OptOutScope | "all-scopes")}
        >
          <SelectTrigger className="sm:w-44" aria-label="Filter by scope">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all-scopes">All scopes</SelectItem>
            <SelectItem value="all">All traffic</SelectItem>
            <SelectItem value="promotional">Promotional</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={source}
          onValueChange={(v) => setSource(v as OptOutSource | "all-sources")}
        >
          <SelectTrigger className="sm:w-44" aria-label="Filter by source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all-sources">All sources</SelectItem>
            <SelectItem value="STOP-reply">STOP reply</SelectItem>
            <SelectItem value="2442-registry">2442 registry</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
          </SelectContent>
        </Select>
        <div className="sm:ml-auto">
          <AddOptOutDialog onAdd={onAdd} />
        </div>
      </div>

      {optOuts.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ShieldOff />
            </EmptyMedia>
            <EmptyTitle>No opt-outs yet</EmptyTitle>
            <EmptyDescription>
              Numbers that reply STOP, appear on the 2442 registry, or are added
              here will be excluded from promotional sends.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <DataTable
          columns={columns}
          data={filtered}
          ariaLabel="Opt-out list"
          empty="No numbers match this filter."
        />
      )}

      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !removing) setPending(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove opt-out?</DialogTitle>
            <DialogDescription>
              <span className="font-mono text-foreground">
                {pending?.msisdn}
              </span>{" "}
              will be eligible for{" "}
              {pending?.scope === "all" ? "all" : "promotional"} messages again.
              This does not override the 2442 registry.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={removing}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={confirmRemove}
              loading={removing}
            >
              Remove opt-out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
