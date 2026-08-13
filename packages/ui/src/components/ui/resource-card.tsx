import { Badge } from "@app/ui/components/ui/badge";
import { Card } from "@app/ui/components/ui/card";
import { cn } from "@app/ui/lib/utils";
import type * as React from "react";

function ResourceCard({
  title,
  status,
  meta,
  description,
  metrics,
  action,
  children,
  className,
}: {
  title: React.ReactNode;
  status?: React.ReactNode;
  meta?: React.ReactNode;
  description?: React.ReactNode;
  metrics?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "group relative gap-4 px-4 py-4 transition-colors hover:border-foreground/25",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate font-semibold leading-tight">{title}</h3>
            {status ? <div className="shrink-0">{status}</div> : null}
          </div>
          {meta ? (
            <div className="mt-1 text-muted-foreground text-sm">{meta}</div>
          ) : null}
        </div>
        {action ? <div className="relative z-10 shrink-0">{action}</div> : null}
      </div>
      {description ? (
        <div className="line-clamp-2 text-sm">{description}</div>
      ) : null}
      {metrics ? (
        <div className="grid gap-2 sm:grid-cols-2">{metrics}</div>
      ) : null}
      {children}
    </Card>
  );
}

function ResourceMetric({
  label,
  value,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-md border bg-muted/20 px-3 py-2", className)}>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="mt-1 truncate font-medium text-sm">{value}</div>
    </div>
  );
}

function ResourceBadge({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Badge variant="secondary" className={className}>
      {children}
    </Badge>
  );
}

export { ResourceBadge, ResourceCard, ResourceMetric };
