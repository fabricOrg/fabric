"use client";

import type {
  CommercialOfferPurchaseReceipt,
  LedgerEntry,
  LedgerEntryType,
} from "@app/contracts";
import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { TableEmptyRow } from "@app/ui/components/ui/states";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@app/ui/components/ui/table";
import { formatDayMonth } from "@app/ui/lib/datetime";
import { cn } from "@app/ui/lib/utils";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BadgeCheck,
  Coins,
  type LucideIcon,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { formatMoney, formatSigned } from "@/lib/money";

/** Ledger-kind chip — color paired with icon + label (never color-only, WCAG). */
const KIND: Record<
  LedgerEntryType,
  { label: string; icon: LucideIcon; cls: string }
> = {
  topup: {
    label: "Top-up",
    icon: ArrowDownLeft,
    cls: "bg-success/12 text-success",
  },
  refund: {
    label: "Refund",
    icon: ArrowDownLeft,
    cls: "bg-success/12 text-success",
  },
  adjustment: {
    label: "Adjustment",
    icon: BadgeCheck,
    cls: "bg-gold-subtle text-gold-ink",
  },
  sms_charge: {
    label: "SMS charge",
    icon: ArrowUpRight,
    cls: "bg-muted text-muted-foreground",
  },
};

const PURCHASE_STATUS: Record<
  CommercialOfferPurchaseReceipt["status"],
  { label: string; cls: string }
> = {
  success: { label: "Paid", cls: "bg-success/12 text-success" },
  pending: { label: "Pending", cls: "bg-warning/15 text-warning" },
  failed: { label: "Failed", cls: "bg-destructive/12 text-destructive" },
};

/**
 * Wallet money movements. Package purchases are deliberately absent: they post to gateway clearing
 * and deferred revenue, never to the customer wallet account, so a running balance beside them
 * would be a number that never moved. They live on the Credits tab, next to what they bought.
 */
export function WalletLedgerCard({
  ledger,
}: {
  ledger: readonly LedgerEntry[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Wallet transactions</CardTitle>
        <CardDescription>
          Top-ups, SMS charges, refunds, and adjustments — with running balance.
        </CardDescription>
        {/* The statement exports these ledger legs, so it belongs with them and nowhere else. */}
        <CardAction>
          <Button asChild variant="outline" size="sm">
            <a href="/api/dashboard/wallet/statement" download>
              Export statement (CSV)
            </a>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {/* Semantic <section> so the scroll region is keyboard-focusable (tabIndex) — running-balance
            columns reachable without a mouse (WCAG 2.1.1 / axe scrollable-region-focusable, QA-DS-4). */}
        <section
          className="overflow-x-auto"
          tabIndex={0}
          aria-label="Wallet transactions"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Transaction</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger.length === 0 ? (
                <TableEmptyRow
                  columns={5}
                  icon={<Wallet />}
                  title="No wallet transactions yet"
                  description="Top-ups, message charges, refunds, and adjustments will appear here."
                />
              ) : (
                ledger.map((entry) => {
                  const { label, icon: Icon, cls } = KIND[entry.type];
                  return (
                    <TableRow key={entry.id}>
                      <TableCell>
                        <span className="font-medium">{label}</span>
                        {entry.reference &&
                          (entry.type === "sms_charge" ? (
                            <Link
                              href={`/messages?messageId=${encodeURIComponent(entry.reference)}`}
                              className="block font-mono text-xs text-primary hover:underline"
                            >
                              View message {entry.reference}
                            </Link>
                          ) : (
                            <span className="block font-mono text-xs text-muted-foreground">
                              {entry.reference}
                            </span>
                          ))}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn("gap-1 border-transparent", cls)}
                        >
                          <Icon />
                          {label}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono tabular-nums",
                          entry.direction === "credit"
                            ? "text-success"
                            : "text-foreground",
                        )}
                      >
                        {formatSigned(entry.amount, entry.direction)}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {formatMoney(entry.runningBalance)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatDayMonth(entry.createdAt)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </section>
      </CardContent>
    </Card>
  );
}

/**
 * Package purchase history, sitting under the packages it bought — "did my payment land, and what
 * did it give me" is one question, so it should not need a second tab to answer.
 *
 * No header of its own: `CreditsPanel` already titles the section and owns the switch that reveals
 * this, so a card title here printed the same sentence twice.
 */
export function PackagePurchasesCard({
  purchases,
}: {
  purchases: readonly CommercialOfferPurchaseReceipt[];
}) {
  return (
    <Card className="py-4">
      <CardContent>
        <section
          className="overflow-x-auto"
          tabIndex={0}
          aria-label="Package purchases"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Package</TableHead>
                <TableHead>Credits granted</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {purchases.length === 0 ? (
                <TableEmptyRow
                  columns={5}
                  icon={<Coins />}
                  title="No package purchases yet"
                  description="Buy a prepaid package and it will appear here with the credits it granted."
                />
              ) : (
                purchases.map((purchase) => {
                  const status = PURCHASE_STATUS[purchase.status];
                  return (
                    <TableRow key={purchase.reference}>
                      <TableCell>
                        <span className="font-medium">
                          {purchase.offer_name}
                        </span>
                        <span className="block font-mono text-xs text-muted-foreground">
                          {purchase.pack_count}× · {purchase.reference}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">
                        {/* Failed and pending purchases granted nothing — say so rather than list
                            quantities the workspace does not actually hold. */}
                        {purchase.status === "success"
                          ? purchase.items
                              .map(
                                (item) =>
                                  `${BigInt(item.quantity).toLocaleString("en")} ${item.channel_code}`,
                              )
                              .join(" · ")
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn("border-transparent", status.cls)}
                        >
                          {status.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatMoney({
                          currency: purchase.currency,
                          minor: purchase.amount_minor,
                        })}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatDayMonth(purchase.created_at)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </section>
      </CardContent>
    </Card>
  );
}
