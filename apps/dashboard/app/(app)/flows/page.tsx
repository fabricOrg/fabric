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
import { useEffect, useMemo, useState } from "react";
import { RunTestTransactionDialog } from "@/components/flows/run-test-transaction-dialog";
import { TransactionRecordView } from "@/components/flows/transaction-record";
import {
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

const OUTCOME_META: Record<Outcome, { label: string; cls: string }> = {
  completed: { label: "Completed", cls: "bg-success/12 text-success" },
  failed: { label: "Failed", cls: "bg-destructive/12 text-destructive" },
  pending: { label: "Pending", cls: "bg-warning/15 text-warning-strong" },
};

export default function TransactionsPage() {
  const [txns, setTxns] = useState<TransactionRecord[] | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Outcome | "all">("all");
  const [detail, setDetail] = useState<TransactionRecord | null>(null);

  useEffect(() => {
    let live = true;
    listTransactions()
      .then((r) => {
        if (live) setTxns(r);
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
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Transactions
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Every verify→charge→notify as one reconciled, audited record.
            Search, reconcile, and trace what happened — the thing three
            separate vendors can't give you.
          </p>
        </div>
        <RunTestTransactionDialog
          onCreated={(record) => setTxns((prev) => [record, ...(prev ?? [])])}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All transactions</CardTitle>
          <CardDescription>
            Runs from the API in production; open a row for the reconciled
            record.
          </CardDescription>
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
                    <TableHead>Channel</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((t) => {
                    const meta = OUTCOME_META[outcome(t)];
                    return (
                      <TableRow
                        key={t.correlationId}
                        onClick={() => setDetail(t)}
                        className="cursor-pointer"
                      >
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-mono text-xs">
                              {t.correlationId}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {t.customer}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatMoney(t.amount)}
                        </TableCell>
                        <TableCell className="uppercase text-muted-foreground">
                          {t.channel}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`border-transparent ${meta.cls}`}
                          >
                            {meta.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {new Date(t.createdAt).toLocaleString("en", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {filtered.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  No transactions yet. Run a test transaction to see the
                  reconciled record.
                </p>
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
