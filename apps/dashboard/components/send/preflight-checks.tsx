import { cn } from "@app/ui/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  type LucideIcon,
  XCircle,
} from "lucide-react";
import type { CheckLevel, PreflightCheck } from "@/lib/send/preflight";

const META: Record<CheckLevel, { icon: LucideIcon; cls: string }> = {
  block: { icon: XCircle, cls: "text-destructive" },
  warn: { icon: AlertTriangle, cls: "text-warning-strong" },
  info: { icon: Info, cls: "text-muted-foreground" },
  pass: { icon: CheckCircle2, cls: "text-success" },
};

/** The preflight list — one row per check, most-severe first, with an icon that reads at a glance. */
export function PreflightChecks({
  checks,
}: {
  checks: readonly PreflightCheck[];
}) {
  const order: Record<CheckLevel, number> = {
    block: 0,
    warn: 1,
    info: 2,
    pass: 3,
  };
  const sorted = [...checks].sort((a, b) => order[a.level] - order[b.level]);

  return (
    <ul className="flex flex-col gap-3">
      {sorted.map((check) => {
        const meta = META[check.level];
        const Icon = meta.icon;
        return (
          <li key={check.id} className="flex gap-2.5">
            <Icon
              className={cn("mt-0.5 size-4 shrink-0", meta.cls)}
              aria-hidden
            />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium leading-tight">
                {check.title}
              </span>
              <span className="text-xs text-muted-foreground">
                {check.detail}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
