"use client";

import { Button } from "@app/ui/components/ui/button";
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
        <div className="hidden h-9 items-center rounded-md border px-3 text-xs text-destructive sm:flex">
          Allowance unavailable
        </div>
      );
    }
    const sms = allowances.data?.allowances.find(
      (item) => item.channel === "sms",
    );
    const email = allowances.data?.allowances.find(
      (item) => item.channel === "email",
    );
    // All three are fetched (the contract pins the array at length 3). Showing two of them meant a
    // workspace burning its WhatsApp quota got no warning before hitting the cap.
    const whatsapp = allowances.data?.allowances.find(
      (item) => item.channel === "whatsapp",
    );
    return (
      <div
        className="hidden h-9 items-center gap-2 rounded-md border px-3 text-xs font-medium sm:flex"
        title={
          allowances.data
            ? `Resets ${formatDateTimeFull(allowances.data.reset_at)}`
            : "Daily workspace sandbox allowance"
        }
      >
        <Coins className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="font-mono tabular-nums">
          {sms?.remaining ?? "—"} SMS segments
        </span>
        <span className="text-muted-foreground" aria-hidden="true">
          ·
        </span>
        <span className="font-mono tabular-nums">
          {email?.remaining ?? "—"} emails
        </span>
        <span className="text-muted-foreground" aria-hidden="true">
          ·
        </span>
        <span className="font-mono tabular-nums">
          {whatsapp?.remaining ?? "—"} WhatsApp
        </span>
      </div>
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
      className="hidden h-9 w-40 animate-pulse rounded-md bg-muted sm:block"
      role="status"
      aria-label="Loading funding status"
    />
  );
}
