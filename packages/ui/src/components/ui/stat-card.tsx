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
 * Standard metric tile, shared across all Fabric apps (overview, insights, wallet, admin).
 *
 * One anatomy so every stat reads the same: an uppercase label, a squared icon plate top-right, a
 * large tabular value with an optional unit set small beside it, and a `children` footer slot for
 * whatever the metric needs — a hint line, a progress bar, a trend, or an action.
 *
 * The plate is square and hairline-bordered rather than a rounded tinted chip: it matches the
 * blueprint frame the surrounding Card draws, and reads as an instrument label.
 *
 *   <StatCard label="Delivery rate" value="94.7" unit="%" icon={CheckCheck}>
 *     <Progress value={94.7} /> <p className="text-muted-foreground text-sm">Delivered of resolved.</p>
 *   </StatCard>
 */
export function StatCard({
  label,
  value,
  unit,
  icon: Icon,
  iconClassName,
  children,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  /** Small uppercase unit set on the value's baseline — "msg", "%", "GHS". */
  unit?: ReactNode;
  icon?: LucideIcon;
  /** Tint for the icon plate (e.g. "bg-warning/10 text-warning"). Defaults to the accent. */
  iconClassName?: string;
  /** Footer content: hint text, a progress bar, a trend, or an action. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardDescription className="truncate">{label}</CardDescription>
          {Icon && (
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center border [&_svg]:size-3.5",
                iconClassName ?? "bg-primary/10 text-primary",
              )}
            >
              <Icon aria-hidden />
            </span>
          )}
        </div>
        <CardTitle className="flex items-baseline gap-1.5 font-display text-3xl tabular-nums tracking-tight">
          {value}
          {unit ? (
            <span className="font-sans text-muted-foreground text-xs">
              {unit}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      {children && (
        <CardContent className="flex flex-col gap-2">{children}</CardContent>
      )}
    </Card>
  );
}
