"use client";

import type { SandboxAllowance } from "@app/contracts";
import { Button } from "@app/ui/components/ui/button";
import {
  CompactSummary,
  CompactSummaryRows,
} from "@app/ui/components/ui/compact-summary";
import { Progress } from "@app/ui/components/ui/progress";
import { formatDateTimeFull } from "@app/ui/lib/datetime";
import { useQuery } from "@tanstack/react-query";
import { Coins, Wallet } from "lucide-react";
import Link from "next/link";
import {
  getMessagingSettings,
  getSandboxAllowances,
  getWallet,
} from "@/lib/client/dashboard-api";
import { formatMoney } from "@/lib/money";

export function HeaderFundingStatus() {
  const settings = useQuery({
    queryKey: ["messaging-settings"],
    queryFn: getMessagingSettings,
  });
  const virtual = settings.data?.delivery_mode === "virtual";
  const live = settings.data?.delivery_mode === "live";
  const allowances = useQuery({
    queryKey: ["sandbox-allowances"],
    queryFn: getSandboxAllowances,
    enabled: virtual,
    refetchInterval: 30_000,
  });
  const wallet = useQuery({
    queryKey: ["wallet"],
    queryFn: getWallet,
    enabled: live,
  });

  if (virtual) {
    if (allowances.isError) {
      return (
        <div className="hidden h-9 items-center rounded-md border px-3 text-xs text-destructive md:flex">
          Allowance unavailable
        </div>
      );
    }

    const entries = sortAllowances(allowances.data?.allowances ?? []);
    const resetAt = allowances.data?.reset_at;

    return (
      <CompactSummary
        label="Sandbox"
        summary={
          entries.length > 0 ? formatAllowanceCount(entries.length) : "Loading"
        }
        title="Sandbox allowances"
        icon={Coins}
        className="hidden md:inline-flex"
      >
        <div className="border-b px-4 py-2.5 text-muted-foreground text-xs">
          {resetAt ? `Resets ${formatDateTimeFull(resetAt)}` : "Loading reset"}
        </div>
        <CompactSummaryRows>
          {entries.length > 0 ? (
            entries.map((allowance) => (
              <AllowanceMeter allowance={allowance} key={allowance.channel} />
            ))
          ) : (
            <div className="p-4 text-muted-foreground text-sm">
              Loading allowances...
            </div>
          )}
        </CompactSummaryRows>
      </CompactSummary>
    );
  }

  if (live) {
    const primary = wallet.data?.[0]?.balance;
    return (
      <Button
        asChild
        variant="outline"
        size="sm"
        className="font-mono tabular-nums"
      >
        <Link href="/wallet">
          <Wallet data-icon="inline-start" />
          {primary ? formatMoney(primary) : "Wallet"}
        </Link>
      </Button>
    );
  }

  return (
    <div
      className="hidden h-9 w-40 animate-pulse rounded-md bg-muted md:block"
      role="status"
      aria-label="Loading funding status"
    />
  );
}

function AllowanceMeter({ allowance }: { allowance: SandboxAllowance }) {
  const limit = Number(allowance.limit);
  const used = Number(allowance.used);
  const remaining = Number(allowance.remaining);
  const progress =
    limit > 0 ? Math.min(100, Math.max(0, (used / limit) * 100)) : 0;

  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-sm">
            {channelLabel(allowance)}
          </p>
          <p className="text-muted-foreground text-xs">
            {unitLabel(allowance, limit)}
          </p>
        </div>
        <div className="text-right font-mono text-xs tabular-nums">
          <span className="font-semibold text-foreground">
            {allowance.remaining}
          </span>
          <span className="text-muted-foreground"> / {allowance.limit}</span>
        </div>
      </div>
      <Progress className="mt-2 h-1.5" value={progress} />
      <div className="mt-1.5 flex items-center justify-between gap-3 text-muted-foreground text-xs">
        <span>{allowance.used} used</span>
        <span>
          {remaining} {unitLabel(allowance, remaining)} left
        </span>
      </div>
    </div>
  );
}

function formatAllowanceCount(count: number): string {
  if (count === 1) {
    return "1 channel";
  }
  return `${count} channels`;
}

const CHANNEL_LABELS: Partial<Record<SandboxAllowance["channel"], string>> = {
  sms: "SMS",
  email: "Email",
  whatsapp: "WhatsApp",
};

function sortAllowances(
  allowances: readonly SandboxAllowance[],
): SandboxAllowance[] {
  return [...allowances].sort(
    (a, b) => channelRank(a.channel) - channelRank(b.channel),
  );
}

function channelLabel(allowance: SandboxAllowance): string {
  return CHANNEL_LABELS[allowance.channel] ?? allowance.channel;
}

function unitLabel(allowance: SandboxAllowance, count: number): string {
  if (allowance.unit === "segment") {
    return count === 1 ? "segment" : "segments";
  }
  return count === 1 ? "message" : "messages";
}

function channelRank(channel: SandboxAllowance["channel"]): number {
  if (channel === "sms") return 0;
  if (channel === "email") return 1;
  if (channel === "whatsapp") return 2;
  return 99;
}
