"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@app/ui/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@app/ui/components/ui/tooltip";
import { Info } from "lucide-react";
import { useMemo } from "react";
import type { InsightsError } from "@/lib/client/insights-api";

/**
 * Short remediation hints per error code (mirrors Twilio's error-code docs). Kept UI-side because
 * the DTO carries only code/description/count; when /v1/insights ships a `docHint`, drop this map.
 */
const DOC_HINTS: Record<string, string> = {
  "30003":
    "Handset is off, out of coverage, or the number is no longer active.",
  "30005": "Number is invalid or has been deactivated by the carrier.",
  "30006":
    "Destination is a landline or an unreachable carrier — verify it is mobile.",
  "30007":
    "Carrier filtered the message as spam. Review content and sender reputation.",
  "30008":
    "Delivery failed for an unknown reason. Retry; escalate if it persists.",
  "21610":
    "Recipient replied STOP. You must not message this number until they opt back in.",
};

const GENERIC_HINT =
  "See the provider's error-code reference for remediation steps.";

const percentFmt = new Intl.NumberFormat("en", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function DeliveryErrorsCard({
  errors,
}: {
  errors: readonly InsightsError[];
}) {
  const { sorted, totalFailures } = useMemo(() => {
    const total = errors.reduce((sum, e) => sum + e.count, 0);
    const next = [...errors].sort((a, b) => b.count - a.count);
    return { sorted: next, totalFailures: total };
  }, [errors]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Delivery &amp; errors</CardTitle>
        <CardDescription>
          Failures grouped by provider error code, most frequent first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 || totalFailures === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No delivery errors in this window. Every message reached its
            carrier.
          </p>
        ) : (
          <section
            className="overflow-x-auto"
            tabIndex={0}
            aria-label="Delivery error breakdown"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Error code</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead className="w-40">% of failures</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((e) => {
                  const share =
                    totalFailures === 0 ? 0 : e.count / totalFailures;
                  const hint = DOC_HINTS[e.code] ?? GENERIC_HINT;
                  return (
                    <TableRow key={e.code}>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-sm tabular-nums">
                            {e.code}
                          </span>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger
                                aria-label={`What is error ${e.code}?`}
                                className="text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                              >
                                <Info className="size-3.5" aria-hidden="true" />
                              </TooltipTrigger>
                              <TooltipContent className="max-w-64">
                                {hint}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {e.description}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {e.count.toLocaleString("en")}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {/* Track (bg-muted) vs fill (bg-destructive) clears 3:1 non-text contrast in both themes. */}
                          <div
                            className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
                            role="presentation"
                          >
                            <div
                              className="h-full rounded-full bg-destructive"
                              style={{ width: `${Math.max(share * 100, 2)}%` }}
                            />
                          </div>
                          <span className="w-12 text-right font-mono text-xs tabular-nums text-muted-foreground">
                            {percentFmt.format(share)}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
