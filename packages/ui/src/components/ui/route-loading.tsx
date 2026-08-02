import {
  PageHeader,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import { Skeleton } from "@app/ui/components/ui/skeleton";
import { LoadingRows } from "@app/ui/components/ui/states";
import { cn } from "@app/ui/lib/utils";

/**
 * Standard `loading.tsx` body for a route segment, shared across all Fabric apps.
 *
 * Most pages here are async server components doing several sequential control-plane reads, and
 * without a segment fallback the router simply holds the previous screen — a click that appears to
 * have done nothing. The heading is REAL markup rather than a skeleton: the title is known before
 * any fetch resolves, so shimmering it would misreport what is actually pending, and it also keeps
 * the page from shifting when the content lands.
 *
 *   export default function Loading() {
 *     return <RouteLoading title="Audit log" description="Every staff action." variant="table" />;
 *   }
 */
export function RouteLoading({
  title,
  description,
  variant = "rows",
  rows = 5,
  className,
}: {
  title: string;
  description?: string;
  /** `rows` for a list, `table` for a bordered table card, `cards` for a tile grid. */
  variant?: "rows" | "table" | "cards";
  rows?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("flex w-full flex-col gap-6", className)}
      aria-busy="true"
    >
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitle>{title}</PageHeaderTitle>
          {description ? (
            <PageHeaderDescription>{description}</PageHeaderDescription>
          ) : null}
        </PageHeaderHeading>
      </PageHeader>

      {variant === "cards" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: rows }, (_, i) => `tile-${i}`).map((key) => (
            <Skeleton key={key} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : variant === "table" ? (
        <div className="rounded-lg border bg-card p-3">
          <LoadingRows rows={rows} className="gap-2" />
        </div>
      ) : (
        <LoadingRows rows={rows} />
      )}

      {/* The visual skeleton is aria-hidden by nature; this is what a screen reader gets. */}
      <span className="sr-only" role="status">
        Loading {title}
      </span>
    </div>
  );
}
