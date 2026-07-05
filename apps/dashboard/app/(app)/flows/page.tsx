"use client";

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@app/ui/components/ui/sheet";
import { Skeleton } from "@app/ui/components/ui/skeleton";
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
  CheckCheck,
  ChevronRight,
  type LucideIcon,
  MessageCircle,
  MessageSquare,
  Receipt,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { RunTestTransactionDialog } from "@/components/flows/run-test-transaction-dialog";
import { TransactionRecordView } from "@/components/flows/transaction-record";
import { VolumeChart } from "@/components/flows/volume-chart";
import {
  type FlowSeriesPoint,
  listTransactions,
  type TransactionRecord,
} from "@/lib/client/flows-api";
import { toastApiError } from "@/lib/error-toast";
import { formatMoney } from "@/lib/money";

type Outcome = "completed" | "failed" | "pending";

function outcome(t: TransactionRecord): Outcome {
  if (t.notify.status === "failed" || t.charge.status === "failed")
    return "failed";
  if (
    t.verify.status === "done" &&
    t.charge.status === "done" &&
    t.notify.status === "done"
  )
    return "completed";
  return "pending";
}

const OUTCOME_META: Record<
  Outcome,
  { label: string; dot: string; cls: string }
> = {
  completed: { label: "Completed", dot: "bg-success", cls: "text-success" },
  failed: { label: "Failed", dot: "bg-destructive", cls: "text-destructive" },
  pending: { label: "Pending", dot: "bg-warning", cls: "text-warning-strong" },
};

function ChannelIcon({ channel }: { channel: string }) {
  const Icon = channel === "whatsapp" ? MessageCircle : MessageSquare;
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
      <Icon className="size-4" />
    </span>
  );
}

/** Icon chip — mirrors the overview StatTiles chip (solid-token tint, WCAG 3:1 in both themes). */
function StatIcon({ icon: Icon, cls }: { icon: LucideIcon; cls: string }) {
  return (
    <span
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4",
        cls,
      )}
    >
      <Icon aria-hidden />
    </span>
  );
}

/** Same card shape as the overview at-a-glance row, so the app reads as one product. */
function StatTile({
  label,
  value,
  icon,
  iconCls,
  helper,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  iconCls: string;
  helper: string;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardDescription>{label}</CardDescription>
          <StatIcon icon={icon} cls={iconCls} />
        </div>
        <CardTitle className="font-mono text-3xl tabular-nums">
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{helper}</p>
      </CardContent>
    </Card>
  );
}

export default function TransactionsPage() {
  const [txns, setTxns] = useState<TransactionRecord[] | null>(null);
  const [series, setSeries] = useState<FlowSeriesPoint[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Outcome | "all">("all");
  const [detail, setDetail] = useState<TransactionRecord | null>(null);

  useEffect(() => {
    let live = true;
    listTransactions()
      .then((r) => {
        if (!live) return;
        setTxns(r.transactions);
        setSeries(r.series);
      })
      .catch((e) => {
        if (!live) return;
        setTxns([]);
        toastApiError(e);
      });
    return () => {
      live = false;
    };
  }, []);

  const stats = useMemo(() => {
    const list = txns ?? [];
    const volume = list.reduce((sum, t) => sum + BigInt(t.amount.minor), 0n);
    return {
      volume: formatMoney({ currency: "GHS", minor: volume.toString() }),
      completed: list.filter((t) => outcome(t) === "completed").length,
      failed: list.filter((t) => outcome(t) === "failed").length,
    };
  }, [txns]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (txns ?? []).filter(
      (t) =>
        (status === "all" || outcome(t) === status) &&
        (t.correlationId.toLowerCase().includes(q) ||
          t.customer.toLowerCase().includes(q)),
    );
  }, [txns, query, status]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Transactions
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Every verify→charge→notify as one reconciled, audited record — the
            thing three separate vendors can't give you.
          </p>
        </div>
        <RunTestTransactionDialog
          onCreated={(record) => setTxns((prev) => [record, ...(prev ?? [])])}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile
          label="Volume"
          value={stats.volume}
          icon={Receipt}
          iconCls="bg-gold-subtle text-gold-ink"
          helper="Collected across all transactions."
        />
        <StatTile
          label="Completed"
          value={String(stats.completed)}
          icon={CheckCheck}
          iconCls="bg-success/15 text-success"
          helper="Verified, charged, and notified."
        />
        <StatTile
          label="Failed"
          value={String(stats.failed)}
          icon={XCircle}
          iconCls="bg-destructive/15 text-destructive"
          helper="Stopped before or during the flow."
        />
      </div>

      {series.length > 0 ? <VolumeChart series={series} /> : null}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-col gap-1">
              <CardTitle className="text-base">All transactions</CardTitle>
              <CardDescription>
                Runs from the API in production; open a row for the reconciled
                record.
              </CardDescription>
            </div>
            {txns ? (
              <Badge variant="secondary" className="shrink-0 tabular-nums">
                {filtered.length}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search id or customer…"
              className="font-mono sm:max-w-xs"
              aria-label="Search transactions"
            />
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as Outcome | "all")}
            >
              <SelectTrigger className="sm:w-44" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {txns === null ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <section
              className="overflow-x-auto"
              tabIndex={0}
              aria-label="Transactions"
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Transaction</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">When</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((t) => {
                    const meta = OUTCOME_META[outcome(t)];
                    return (
                      <TableRow
                        key={t.correlationId}
                        onClick={() => setDetail(t)}
                        className="group cursor-pointer"
                      >
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <ChannelIcon channel={t.channel} />
                            <div className="flex flex-col">
                              <span className="font-mono text-xs">
                                {t.correlationId}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {t.customer} · {t.channel.toUpperCase()}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatMoney(t.amount)}
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-1.5 text-sm">
                            <span
                              className={`size-1.5 rounded-full ${meta.dot}`}
                            />
                            <span className={meta.cls}>{meta.label}</span>
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {new Date(t.createdAt).toLocaleString("en", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </TableCell>
                        <TableCell className="text-right">
                          <ChevronRight className="size-4 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center gap-2 p-10 text-center">
                  <Receipt className="size-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    No transactions match. Run a test transaction to see the
                    reconciled record.
                  </p>
                </div>
              ) : null}
            </section>
          )}
        </CardContent>
      </Card>

      <Sheet
        open={detail !== null}
        onOpenChange={(open) => !open && setDetail(null)}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="font-display">Transaction record</SheetTitle>
            <SheetDescription>
              Verification, ledger, and message — one correlation id.
            </SheetDescription>
          </SheetHeader>
          {detail ? (
            <div className="px-4 pb-6">
              <TransactionRecordView record={detail} />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
