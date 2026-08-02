import type { TokenBalanceDto } from "@app/contracts";
import { StatCard } from "@app/ui/components/ui/stat-card";
import { formatDayMonth } from "@app/ui/lib/datetime";
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
  sms: { label: "SMS segments", unit: "seg", icon: MessageSquare },
  email: { label: "Email messages", unit: "msg", icon: Mail },
};

function describe(channel: string) {
  return CHANNEL[channel] ?? { label: channel, unit: "credits", icon: Coins };
}

/** Whole days from now until expiry, floored — 0 means it lapses today. */
function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** Under a fortnight is close enough that "use it or lose it" should be the loud part. */
const URGENT_DAYS = 14;

/**
 * Prepaid credits, first thing on the page.
 *
 * A package purchase does not move the wallet balance — the money is deferred revenue until the
 * credits are spent — so without this the customer pays and sees nothing change anywhere. "Where did
 * my purchase go?" is the question this section exists to answer.
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
    <section className="flex flex-col gap-4" aria-label="Prepaid credits">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-medium text-sm">Prepaid credits</h2>
        <span className="text-muted-foreground text-xs">
          Spent before your wallet balance, on sends the package covers.
        </span>
      </div>
      {/* gap-6: the Card registration marks are drawn outside the border and collide when tighter. */}
      <div className="grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(min(230px,100%),1fr))]">
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

/**
 * One channel's credits: the spendable total, then what it is actually made of.
 *
 * The breakdown is driven entirely by `expiry_groups`, so it holds for any channel and for any
 * number of distinct expiry dates. A single group needs no bar — there is no composition to show.
 */
function CreditTile({ balance }: { balance: TokenBalanceDto }) {
  const channel = describe(balance.channel);
  const total = BigInt(balance.available);
  const groups = balance.expiry_groups;
  const soonest = groups.find((group) => group.expires_at !== null);
  const urgent =
    soonest?.expires_at !== undefined &&
    soonest.expires_at !== null &&
    daysUntil(soonest.expires_at) <= URGENT_DAYS;
  const granted = BigInt(balance.granted_total);
  const consumed = BigInt(balance.consumed_total);
  // Display-only width; the counts themselves stay bigint. Clamped because a lot can be expired
  // away as well as spent, so consumed never exceeds granted but the bar must not assume it.
  const usedPct =
    granted > 0n
      ? Math.min(100, Number((consumed * 10000n) / granted) / 100)
      : 0;

  return (
    <StatCard
      label={channel.label}
      value={total.toLocaleString("en")}
      unit={channel.unit}
      icon={channel.icon}
      iconClassName={
        urgent ? "bg-warning/10 text-warning" : "bg-primary/10 text-primary"
      }
      className="gap-3"
    >
      {/* Consumption against what was bought. This replaced a bar of the expiry split, which the
          lines below already state in words — a second encoding of the same fact earned nothing,
          whereas "how much have I actually used" was not shown anywhere. */}
      {granted > 0n ? (
        <div className="flex flex-col gap-1.5">
          <div
            className="flex h-1 overflow-hidden bg-foreground/10"
            role="img"
            aria-label={`${consumed.toLocaleString("en")} of ${granted.toLocaleString("en")} used`}
          >
            <span
              className="h-full bg-primary/70"
              style={{ width: `${usedPct}%` }}
            />
          </div>
          <p className="flex items-baseline justify-between gap-2 text-muted-foreground text-xs">
            <span>
              <span className="font-medium tabular-nums text-foreground">
                {consumed.toLocaleString("en")}
              </span>{" "}
              used
            </span>
            <span className="tabular-nums">
              of {granted.toLocaleString("en")} bought
            </span>
          </p>
        </div>
      ) : null}

      {/* No groups means the breakdown is UNAVAILABLE, not that nothing expires. Saying "Never
          expires" here would invent a guarantee out of missing data — show the total alone. */}
      {groups.length === 0 ? null : (
        <ul className="flex flex-col gap-1">
          {groups.map((group) => (
            <ExpiryLine
              key={group.expires_at ?? "permanent"}
              quantity={BigInt(group.available)}
              expiresAt={group.expires_at}
              /** A lone group describes the whole balance, so it needs no quantity repeated. */
              showQuantity={groups.length > 1}
            />
          ))}
        </ul>
      )}
    </StatCard>
  );
}

function ExpiryLine({
  quantity,
  expiresAt,
  showQuantity,
}: {
  quantity: bigint;
  expiresAt: string | null;
  showQuantity: boolean;
}) {
  if (expiresAt === null) {
    return (
      <li className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <InfinityIcon className="size-3 shrink-0" aria-hidden="true" />
        {showQuantity ? (
          <>
            <span className="font-medium tabular-nums text-foreground">
              {quantity.toLocaleString("en")}
            </span>
            never expire
          </>
        ) : (
          "Never expires"
        )}
      </li>
    );
  }

  const days = daysUntil(expiresAt);
  const urgent = days <= URGENT_DAYS;
  const when =
    days === 0 ? "today" : `in ${days} ${days === 1 ? "day" : "days"}`;
  return (
    <li
      className={cn(
        "flex items-center gap-1.5 text-xs",
        urgent ? "font-medium text-warning" : "text-muted-foreground",
      )}
    >
      <Clock className="size-3 shrink-0" aria-hidden="true" />
      {showQuantity ? (
        <>
          <span
            className={cn(
              "font-medium tabular-nums",
              urgent ? "text-warning" : "text-foreground",
            )}
          >
            {quantity.toLocaleString("en")}
          </span>
          expire {when}
        </>
      ) : (
        `Expires ${when}`
      )}
      <span className="ml-auto shrink-0 tabular-nums opacity-70">
        {formatDayMonth(expiresAt)}
      </span>
    </li>
  );
}
