import { Badge } from "@app/ui/components/ui/badge";
import { cn } from "@app/ui/lib/utils";

export function ProductMark({
  product,
  compact = false,
  className,
}: {
  product: "Dashboard" | "Admin" | "Developer";
  compact?: boolean;
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
        className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground"
        aria-hidden="true"
      >
        F
      </div>
      {!compact ? (
        <>
          <span className="truncate font-display text-lg font-semibold group-data-[collapsible=icon]:hidden">
            Fabric
          </span>
          <Badge
            variant="secondary"
            className="ml-auto text-[10px] uppercase group-data-[collapsible=icon]:hidden"
          >
            {product}
          </Badge>
        </>
      ) : null}
      <span className="sr-only">Fabric {product}</span>
    </div>
  );
}
