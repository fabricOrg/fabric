import { Badge } from "@app/ui/components/ui/badge";
import { cn } from "@app/ui/lib/utils";

export function ProductMark({
  product,
  compact = false,
  showBadge = true,
  className,
}: {
  product: "Dashboard" | "Admin" | "Developer";
  compact?: boolean;
  /** The product badge next to the wordmark. Off for the customer dashboard (one app post-merge;
   *  environment is shown by the topbar toggle + banner). The sr-only label is kept regardless. */
  showBadge?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2.5 px-2 py-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0",
        className,
      )}
    >
      <div
        className="relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-primary/20 bg-primary text-sm font-bold text-primary-foreground shadow-sm before:absolute before:inset-0 before:bg-[linear-gradient(135deg,transparent_0_42%,color-mix(in_srgb,var(--primary-foreground)_26%,transparent)_42%_44%,transparent_44%_100%)]"
        aria-hidden="true"
      >
        <span className="relative">F</span>
      </div>
      {!compact ? (
        <>
          <span className="truncate font-display text-lg font-semibold group-data-[collapsible=icon]:hidden">
            Fabric
          </span>
          {showBadge ? (
            <Badge
              variant="secondary"
              className="ml-auto text-[10px] uppercase group-data-[collapsible=icon]:hidden"
            >
              {product}
            </Badge>
          ) : null}
        </>
      ) : null}
      <span className="sr-only">Fabric {product}</span>
    </div>
  );
}
