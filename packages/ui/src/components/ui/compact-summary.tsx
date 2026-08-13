import { Button } from "@app/ui/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@app/ui/components/ui/popover";
import { cn } from "@app/ui/lib/utils";
import { ChevronDown, type LucideIcon } from "lucide-react";
import type * as React from "react";

type CompactSummaryProps = {
  label: string;
  summary: React.ReactNode;
  title: string;
  icon?: LucideIcon;
  align?: React.ComponentProps<typeof PopoverContent>["align"];
  className?: string;
  contentClassName?: string;
  children: React.ReactNode;
};

function CompactSummary({
  label,
  summary,
  title,
  icon: Icon,
  align = "end",
  className,
  contentClassName,
  children,
}: CompactSummaryProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("max-w-64 gap-2", className)}
        >
          {Icon ? <Icon data-icon="inline-start" /> : null}
          <span className="truncate">{label}</span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
            {summary}
          </span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className={cn("w-80 p-0", contentClassName)}
      >
        <div className="border-b px-4 py-3">
          <p className="font-medium text-sm">{title}</p>
        </div>
        {children}
      </PopoverContent>
    </Popover>
  );
}

function CompactSummaryRows({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="compact-summary-rows"
      className={cn("flex flex-col gap-2 p-3", className)}
      {...props}
    />
  );
}

function CompactSummaryRow({
  label,
  value,
  detail,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  detail?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-md border bg-card px-3 py-2", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-sm">{label}</p>
          {detail ? (
            <p className="text-muted-foreground text-xs">{detail}</p>
          ) : null}
        </div>
        <div className="text-right font-mono text-xs tabular-nums">{value}</div>
      </div>
    </div>
  );
}

export { CompactSummary, CompactSummaryRow, CompactSummaryRows };
