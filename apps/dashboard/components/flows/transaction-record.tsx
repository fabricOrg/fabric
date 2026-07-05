"use client";

import { Badge } from "@app/ui/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import {
  BadgeCheck,
  Banknote,
  Check,
  MessageSquare,
  ScrollText,
} from "lucide-react";
import type {
  LedgerEntry,
  StepStatus,
  TransactionRecord,
} from "@/lib/client/flows-api";
import { formatMoney } from "@/lib/money";

const STEP_TONE: Record<StepStatus, string> = {
  done: "border-transparent bg-success/12 text-success",
  failed: "border-transparent bg-destructive/12 text-destructive",
  skipped: "border-transparent bg-muted text-muted-foreground",
  pending: "border-transparent bg-warning/15 text-warning-strong",
};

function StepBadge({ status }: { status: StepStatus }) {
  return (
    <Badge variant="outline" className={STEP_TONE[status]}>
      {status === "done" ? "Verified" : status}
    </Badge>
  );
}

function money(entry: LedgerEntry) {
  return formatMoney(entry.amount);
}

/** Sum minor units per direction with bigint — the ledger is balanced iff debits === credits. */
function balanced(entries: readonly LedgerEntry[]): boolean {
  let debit = 0n;
  let credit = 0n;
  for (const e of entries) {
    if (e.direction === "debit") debit += BigInt(e.amount.minor);
    else credit += BigInt(e.amount.minor);
  }
  return debit === credit && entries.length > 0;
}

export function TransactionRecordView({
  record,
}: {
  record: TransactionRecord;
}) {
  const isBalanced = balanced(record.charge.entries);
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <CardTitle className="font-display">Transaction</CardTitle>
            <CardDescription className="font-mono text-xs">
              {record.correlationId}
            </CardDescription>
          </div>
          <div className="text-right">
            <div className="font-mono text-xl font-semibold tabular-nums">
              {formatMoney(record.amount)}
            </div>
            <div className="text-xs text-muted-foreground">
              {record.customer} · {record.channel.toUpperCase()}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {/* One correlation id ties verification + ledger + message — the reconciled record. */}
        <Step
          icon={<BadgeCheck className="size-4" />}
          title="Verified"
          status={record.verify.status}
          detail={record.verify.verificationId ?? "—"}
        />

        <div className="flex flex-col gap-2">
          <Step
            icon={<Banknote className="size-4" />}
            title="Charged"
            status={record.charge.status}
            detail={
              isBalanced ? "Double-entry · balanced" : "Ledger not balanced"
            }
            detailTone={isBalanced ? "success" : "destructive"}
          />
          <div className="rounded-lg border">
            {record.charge.entries.map((e, i) => (
              <div
                key={e.account}
                className={`flex items-center justify-between gap-3 px-3 py-2 text-sm ${
                  i > 0 ? "border-t" : ""
                }`}
              >
                <div className="flex flex-col">
                  <span>{e.label}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {e.account}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs uppercase text-muted-foreground">
                    {e.direction}
                  </span>
                  <span className="font-mono tabular-nums">{money(e)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <Step
          icon={<MessageSquare className="size-4" />}
          title="Notified"
          status={record.notify.status}
          detail={record.notify.messageId ?? "—"}
        />

        <div className="flex items-center gap-1.5 border-t pt-4 text-xs text-muted-foreground">
          <ScrollText className="size-3.5" />
          Audit · {record.audit.actor} ·{" "}
          {new Date(record.audit.at).toLocaleString("en", {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function Step({
  icon,
  title,
  status,
  detail,
  detailTone,
}: {
  icon: React.ReactNode;
  title: string;
  status: StepStatus;
  detail: string;
  detailTone?: "success" | "destructive";
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success/12 text-success">
        {status === "done" ? <Check className="size-4" /> : icon}
      </span>
      <div className="flex flex-1 flex-col">
        <span className="text-sm font-medium">{title}</span>
        <span
          className={`font-mono text-xs ${
            detailTone === "destructive"
              ? "text-destructive"
              : detailTone === "success"
                ? "text-success"
                : "text-muted-foreground"
          }`}
        >
          {detail}
        </span>
      </div>
      <StepBadge status={status} />
    </div>
  );
}
