// Cost-estimate panel (F5.2 Send) — the dedicated money card from the Send mockup. Replaces the old
// compact inline meter. All figures are computed in the page from the canonical @app/domain math
// (encodeAndSegment + rateSegments) and exact-bigint formatMoney; this component only presents them.
// Balance-after-send makes the spend consequence legible before the charge (trust anchor).

import { Badge } from "@app/ui/components/ui/badge";
import { Separator } from "@app/ui/components/ui/separator";
import type React from "react";

export interface CostEstimatePanelProps {
  readonly recipients: number;
  readonly encoding: "gsm7" | "ucs2";
  readonly segmentsPerMessage: number;
  readonly ratePerSegmentLabel: string;
  readonly estimatedTotalLabel: string;
  readonly balanceAfterLabel: string | null;
  readonly insufficient: boolean;
}

export function CostEstimatePanel({
  recipients,
  encoding,
  segmentsPerMessage,
  ratePerSegmentLabel,
  estimatedTotalLabel,
  balanceAfterLabel,
  insufficient,
}: CostEstimatePanelProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Cost estimate</span>
        <Badge variant="outline" className="font-mono">
          {encoding === "ucs2" ? "UCS-2" : "GSM-7"}
        </Badge>
      </div>
      <dl className="flex flex-col gap-1.5 text-sm">
        <EstRow
          label="Recipients"
          value={<span className="tabular-nums">{recipients}</span>}
        />
        <EstRow
          label="Segments / message"
          value={<span className="tabular-nums">{segmentsPerMessage}</span>}
        />
        <EstRow
          label="Rate / segment"
          value={
            <span className="font-mono tabular-nums">
              {ratePerSegmentLabel}
            </span>
          }
        />
        <Separator className="my-1" />
        <EstRow
          label="Estimated total"
          value={
            <span className="font-mono tabular-nums font-semibold">
              {estimatedTotalLabel}
            </span>
          }
          strong
        />
        <EstRow
          label="Balance after send"
          value={
            <span
              className={`font-mono tabular-nums ${insufficient ? "text-destructive" : "text-muted-foreground"}`}
            >
              {balanceAfterLabel ?? "—"}
            </span>
          }
        />
      </dl>
      {insufficient ? (
        <p className="text-xs text-destructive">
          This send exceeds your balance. Top up before sending.
        </p>
      ) : null}
    </div>
  );
}

function EstRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className={strong ? "text-foreground" : "text-muted-foreground"}>
        {label}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}
