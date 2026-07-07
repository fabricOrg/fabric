import { Skeleton } from "@app/ui/components/ui/skeleton";
import { cn } from "@app/ui/lib/utils";

export type ChartSkeletonVariant = "area" | "line" | "bar" | "pie";

// Deterministic bar heights (no Math.random — stable across renders/SSR).
const BAR_HEIGHTS = [45, 70, 55, 85, 60, 95, 75, 65, 90, 50, 80, 68];

/**
 * Standardised loading placeholder for charts, shaped by graph type so the skeleton reads like the
 * chart it precedes (bars for bar, a filled plot + axis ticks for area/line, a ring + legend for
 * pie). Size it with `className` (e.g. `h-64`) to match the real chart's height. Pair with a lazy-
 * loaded chart body so heavy chart JS never blocks first paint.
 */
export function ChartSkeleton({
  variant = "area",
  className,
}: {
  variant?: ChartSkeletonVariant;
  className?: string;
}) {
  if (variant === "pie") {
    return (
      <div
        className={cn("flex items-center justify-center gap-6", className)}
        aria-hidden
      >
        <Skeleton className="size-32 rounded-full" />
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-3 w-24" />
          ))}
        </div>
      </div>
    );
  }

  if (variant === "bar") {
    return (
      <div className={cn("flex flex-col gap-2", className)} aria-hidden>
        <div className="flex flex-1 items-end gap-2">
          {BAR_HEIGHTS.map((h, i) => (
            <Skeleton
              key={`bar-${i}-${h}`}
              className="w-full rounded-sm"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
        <AxisTicks />
      </div>
    );
  }

  // area / line — a filled plot block + x-axis ticks.
  return (
    <div className={cn("flex flex-col gap-2", className)} aria-hidden>
      <Skeleton className="flex-1 rounded-md" />
      <AxisTicks />
    </div>
  );
}

function AxisTicks() {
  return (
    <div className="flex items-center justify-between">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} className="h-3 w-8" />
      ))}
    </div>
  );
}
