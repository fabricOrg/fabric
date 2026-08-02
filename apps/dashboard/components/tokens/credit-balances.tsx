import type { TokenBalanceDto } from "@app/contracts";
import { StatCard } from "@app/ui/components/ui/stat-card";
import { cn } from "@app/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
  Clock,
  Coins,
  Infinity as InfinityIcon,
  Mail,
  MessageSquare,
} from "lucide-react";

/** What a channel's credits are called in the customer's language, not the registry's. */
const CHANNEL: Record<
  string,
  { label: string; unit: string; icon: LucideIcon }
> = {
  sms: { label: "SMS", unit: "segments", icon: MessageSquare },
  email: { label: "Email", unit: "messages", icon: Mail },
};

function describe(channel: string) {
  return CHANNEL[channel] ?? { label: channel, unit: "credits", icon: Coins };
}

/** Whole days from now until expiry, floored — 0 means it lapses today. */
function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en", {
    day: "numeric",
    month: "short",
  });
}

/**
 * Prepaid credits, first thing on the page.
 *
 * A package purchase does not move the wallet balance — the money is deferred revenue until the
 * credits are spent — so without this the customer pays and sees nothing change anywhere. "Where did
 * my purchase go?" is the question this section exists to answer, which is why it sits above the
 * catalog rather than beside it.
 *
 * The tile shows the counter as the headline and the expiring / permanent split beneath it. Holding
 * both at once is normal — one package with a validity window, one without — and a single "expires
 * in 59 days" line over the combined number is simply false for the permanent part.
 */
export function CreditBalances({
  balances,
}: {
  balances: readonly TokenBalanceDto[];
}) {
  const spendable = balances.filter(
    (balance) => BigInt(balance.available) > 0n,
  );
  if (spendable.length === 0) return null;

  return (
    <section className="flex flex-col gap-3" aria-label="Prepaid credits">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-medium text-sm">Your prepaid credits</h2>
        <p className="text-muted-foreground text-xs">
          Spent before your wallet balance, on sends the package covers.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {spendable.map((balance) => (
          <CreditTile
            key={`${balance.channel}:${balance.currency}`}
            balance={balance}
          />
        ))}
      </div>
    </section>
  );
}

function CreditTile({ balance }: { balance: TokenBalanceDto }) {
  const channel = describe(balance.channel);
  const expiry = balance.expires_next_at;
  const permanent = BigInt(balance.never_expires_available);
  const expiring = BigInt(balance.expiring_available);
  const days = expiry === null ? null : daysUntil(expiry);
  // Under a fortnight is close enough that "use it or lose it" is the loud part.
  const urgent = days !== null && days <= 14;
  const mixed = permanent > 0n && expiring > 0n;
  // Accent reads the RISK in the tile: any dated credit tints it, and a mixed holding still has
  // something to lose, so it is not treated as safe just because part of it is permanent.
  const accent =
    expiring === 0n
      ? "border-l-primary/40"
      : urgent
        ? "border-l-warning"
        : "border-l-warning/40";

  return (
    <StatCard
      label={`${channel.label} ${channel.unit}`}
      value={BigInt(balance.available).toLocaleString("en")}
      icon={channel.icon}
      iconClassName={
        expiring === 0n
          ? "bg-primary/12 text-primary"
          : "bg-warning/12 text-warning"
      }
      className={cn("border-l-2", accent)}
    >
      {/* Only a mixed holding needs two lines. A single-kind balance says its one fact once. */}
      {mixed ? (
        <div className="flex flex-col gap-1">
          <BreakdownLine
            icon={InfinityIcon}
            quantity={permanent}
            text="never expire"
          />
          <BreakdownLine
            icon={Clock}
            quantity={expiring}
            text={
              days === null
                ? "expire later"
                : days === 0
                  ? "expire today"
                  : `expire in ${days} ${days === 1 ? "day" : "days"}`
            }
            trailing={expiry === null ? undefined : shortDate(expiry)}
            urgent={urgent}
          />
        </div>
      ) : expiring === 0n ? (
        <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
          <InfinityIcon className="size-3.5" aria-hidden="true" />
          Never expires
        </p>
      ) : (
        <p
          className={cn(
            "flex items-center gap-1.5 text-xs",
            urgent ? "font-medium text-warning" : "text-muted-foreground",
          )}
        >
          <Clock className="size-3.5" aria-hidden="true" />
          {days === null
            ? "Expires later"
            : days === 0
              ? "Expires today"
              : `Expires in ${days} ${days === 1 ? "day" : "days"}`}
          {expiry === null ? null : (
            <span className="ml-auto tabular-nums opacity-70">
              {shortDate(expiry)}
            </span>
          )}
        </p>
      )}
    </StatCard>
  );
}

function BreakdownLine({
  icon: Icon,
  quantity,
  text,
  trailing,
  urgent = false,
}: {
  icon: LucideIcon;
  quantity: bigint;
  text: string;
  trailing?: string;
  urgent?: boolean;
}) {
  return (
    <p
      className={cn(
        "flex items-center gap-1.5 text-xs",
        urgent ? "font-medium text-warning" : "text-muted-foreground",
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="font-medium tabular-nums text-foreground">
        {quantity.toLocaleString("en")}
      </span>
      {text}
      {trailing ? (
        <span className="ml-auto tabular-nums opacity-70">{trailing}</span>
      ) : null}
    </p>
  );
}
