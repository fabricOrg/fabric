import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { cn } from "@app/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Standard metric tile, shared across all Fabric apps (overview, insights, wallet, admin). A label +
 * a big mono/tabular value, an optional tinted icon chip top-right, and a `children` footer slot for
 * whatever the metric needs (a hint line, a progress bar, a trend, or an action button). One anatomy
 * so every stat reads the same.
 *
 *   <StatCard label="Delivery rate" value="94.7%" icon={CheckCheck}
 *     iconClassName="bg-success/15 text-success">
 *     <Progress value={94.7} /> <p className="text-sm text-muted-foreground">Delivered of resolved.</p>
 *   </StatCard>
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  iconClassName,
  children,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  icon?: LucideIcon;
  /** Tint classes for the icon chip (e.g. "bg-primary/12 text-primary"). */
  iconClassName?: string;
  /** Footer content: hint text, a progress bar, a trend, or an action. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardDescription>{label}</CardDescription>
          {Icon && (
            <span
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4",
                iconClassName,
              )}
            >
              <Icon aria-hidden />
            </span>
          )}
        </div>
        <CardTitle className="font-mono text-3xl tabular-nums">
          {value}
        </CardTitle>
      </CardHeader>
      {children && (
        <CardContent className="flex flex-col gap-2">{children}</CardContent>
      )}
    </Card>
  );
}
