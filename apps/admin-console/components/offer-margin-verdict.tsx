"use client";

import type { CommercialOfferMarginPreview, Currency } from "@app/contracts";
import { Badge } from "@app/ui/components/ui/badge";
import { formatMoney } from "@/lib/money";

/**
 * The publish gate's answer, rendered as evidence rather than a verdict badge alone: staff should be
 * able to see WHICH route is the problem, because the fix is usually narrowing eligibility or getting
 * a better rate, not raising the price.
 *
 * The worst permitted route is what the floor is enforced against — a bundle is spendable on every
 * route it allows, so the cheapest one proves nothing.
 */
export function MarginVerdict({
  verdict,
  stale,
  unitLabel,
  currency,
}: {
  verdict: CommercialOfferMarginPreview | null;
  /** The terms have been edited since this verdict was computed, so it describes different numbers. */
  stale: boolean;
  unitLabel: string;
  currency: Currency;
}) {
  if (!verdict) {
    return (
      <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        Run <span className="font-medium">Check margin</span> to price every
        route this offer permits before publishing.
      </p>
    );
  }

  const snapshot = verdict.cost_snapshot;
  if (stale) {
    // Deliberately hide the old numbers rather than dimming them: a "Publishable" badge next to edited
    // terms is the one thing this panel must never show, and the gate will re-decide on publish anyway.
    return (
      <p className="rounded-md border border-dashed border-warning/60 p-3 text-sm text-muted-foreground">
        These terms changed since the last check.{" "}
        <span className="font-medium">Check margin</span> again — the previous
        verdict described different numbers.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        {verdict.publishable ? (
          <Badge className="border-transparent bg-success/12 text-success">
            Publishable
          </Badge>
        ) : (
          <Badge variant="destructive">Blocked</Badge>
        )}
        {/*
          Named "Informational" in the UI, not just in a comment. This is the one place a per-unit
          figure sits beside a verdict, and the fixed TOTAL is the price charged — a rounded per-unit
          rate is exactly what ADR-0012 refuses to treat as financial truth.
        */}
        <span className="text-xs text-muted-foreground">
          {verdict.items.length} channel allocation
          {verdict.items.length === 1 ? "" : "s"}; the {unitLabel} total is what
          is charged.
        </span>
      </div>

      {verdict.blocked_detail ? (
        <p className="text-sm text-destructive">{verdict.blocked_detail}</p>
      ) : null}

      {snapshot ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
          <Stat
            label="Worst-case cost"
            value={formatMoney({
              currency,
              minor: snapshot.worst_case_cost_minor,
            })}
          />
          <Stat
            label="Worst-case margin"
            value={`${(snapshot.worst_case_margin_bps / 100).toFixed(2)}%`}
          />
          <Stat
            label="Floor"
            value={`${(snapshot.minimum_margin_bps / 100).toFixed(2)}%${
              snapshot.minimum_margin_source === "platform_default"
                ? " (platform default)"
                : ""
            }`}
          />
          <Stat label="Routes priced" value={String(snapshot.route_count)} />
        </dl>
      ) : null}

      {verdict.routes.length > 0 ? (
        <div className="max-h-40 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="font-normal">Route</th>
                <th className="font-normal">Cost</th>
                <th className="font-normal">Margin</th>
              </tr>
            </thead>
            <tbody>
              {verdict.routes.map((route) => (
                <tr
                  key={`${route.provider_cost_rate_id}-${route.destination_country ?? "any"}-${route.traffic_class ?? "any"}`}
                  className={route.meets_floor ? "" : "text-destructive"}
                >
                  <td className="py-0.5">
                    {route.provider_vendor} ·{" "}
                    {route.destination_country ?? "any destination"} ·{" "}
                    {route.traffic_class ?? "any class"}
                  </td>
                  <td className="py-0.5">
                    {formatMoney({ currency, minor: route.total_cost_minor })}
                  </td>
                  <td className="py-0.5">
                    {(route.margin_bps / 100).toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
