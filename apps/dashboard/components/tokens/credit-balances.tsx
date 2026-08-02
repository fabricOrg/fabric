import type { TokenBalanceDto } from "@app/contracts";
import { Card, CardContent } from "@app/ui/components/ui/card";
import type { LucideIcon } from "lucide-react";
import { Coins, Mail, MessageSquare } from "lucide-react";

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

/**
 * Prepaid credits, first thing on the page.
 *
 * A package purchase does not move the wallet balance — the money is deferred revenue until the
 * credits are spent — so without this the customer pays and sees nothing change anywhere. "Where did
 * my purchase go?" is the question this section exists to answer, which is why it sits above the
 * catalog rather than beside it.
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
        {spendable.map((balance) => {
          const channel = describe(balance.channel);
          const Icon = channel.icon;
          const expiry = balance.expires_next_at;
          return (
            <Card key={`${balance.channel}:${balance.currency}`}>
              <CardContent className="flex items-center gap-3 py-4">
                <span className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div className="flex flex-col">
                  <span className="font-display text-2xl tabular-nums leading-none">
                    {BigInt(balance.available).toLocaleString("en")}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {channel.label} {channel.unit}
                    {expiry === null
                      ? null
                      : ` · expires ${new Date(expiry).toLocaleDateString(
                          "en-GB",
                          {
                            day: "numeric",
                            month: "short",
                          },
                        )}`}
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
