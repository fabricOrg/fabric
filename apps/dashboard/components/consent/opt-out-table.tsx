"use client";

import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@app/ui/components/ui/table";
import { cn } from "@app/ui/lib/utils";
import { ShieldOff, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  type OptOut,
  type OptOutScope,
  type OptOutSource,
  removeOptOut,
} from "@/lib/client/consent-api";
import { toastApiError } from "@/lib/error-toast";
import { AddOptOutDialog } from "./add-opt-out-dialog";

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
        <section
          className="overflow-x-auto"
          tabIndex={0}
          aria-label="Opt-out list"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-mono text-sm">
                    {o.msisdn}
                  </TableCell>
                  <TableCell>
                    <ScopeBadge scope={o.scope} />
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="border-transparent bg-muted text-muted-foreground"
                    >
                      {SOURCE_LABEL[o.source]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(o.at).toLocaleDateString("en", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPending(o)}
                      aria-label={`Remove opt-out for ${o.msisdn}`}
                    >
                      <Trash2 />
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {filtered.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No numbers match this filter.
            </p>
          )}
        </section>
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
