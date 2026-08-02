import { Badge } from "@app/ui/components/ui/badge";
import { cn } from "@app/ui/lib/utils";
import type { LucideIcon } from "lucide-react";

/**
 * How a status READS, not what it means. Five tones, and every domain maps its own vocabulary onto
 * them — `delivered`, `active` and `2xx` are all `success` without this file learning any of those
 * words.
 *
 * That split is deliberate. Seven separate `StatusBadge` components had grown across the two apps,
 * each re-deciding the same styling question, and they had drifted: `bg-warning/15` was paired with
 * `text-warning` in three of them and `text-warning-strong` in the others. That is not a preference
 * — base `--warning` measures 3.73:1 on that tint and FAILS WCAG AA, which is the whole reason
 * `--warning-strong` exists. Centralising the tone fixes all three at once and stops the next one
 * being written wrong.
 *
 * The alternative — one component that knows every status string in the product — would drag message
 * lifecycles, staff states, HTTP codes and offer lifecycles into the design system, and each new
 * domain would have to edit a shared file to render a badge. Domain vocabulary stays with its domain.
 */
export type StatusTone =
  | "neutral" // terminal-but-uneventful: queued, closed, disabled, expired
  | "info" // in flight, nothing decided yet: sending, accepted, draft
  | "success" // the good terminal outcome: delivered, active, published
  | "warning" // needs attention, not a failure: undelivered, pending, suspended
  | "danger"; // failed outright: failed, rejected, 5xx

/**
 * Colour is never the only signal (WCAG 1.4.1): a tone always accompanies a text label, and callers
 * pass an icon wherever the state is worth scanning for.
 */
const TONE: Record<StatusTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-primary/10 text-primary",
  success: "bg-success/12 text-success",
  warning: "bg-warning/15 text-warning-strong",
  danger: "bg-destructive/12 text-destructive",
};

export function StatusBadge({
  tone,
  label,
  icon: Icon,
  className,
}: {
  tone: StatusTone;
  label: string;
  /** Optional; pass one where the state is scanned down a column rather than read. */
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 border-transparent", TONE[tone], className)}
    >
      {Icon ? <Icon /> : null}
      {label}
    </Badge>
  );
}
