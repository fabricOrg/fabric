import { Badge } from "@app/ui/components/ui/badge";
import { cn } from "@app/ui/lib/utils";
import {
  Check,
  CheckCheck,
  Clock,
  Loader,
  type LucideIcon,
  Send,
  TriangleAlert,
  XCircle,
} from "lucide-react";

/** The platform's 8-state message lifecycle (mirrors @app/contracts messageStatus / STATUS_RANK). */
export type MessageStatus =
  | "queued"
  | "sending"
  | "accepted"
  | "sent"
  | "delivered"
  | "undelivered"
  | "failed"
  | "expired";

/**
 * Colour is never the only signal (WCAG): every state pairs a semantic token with an icon + label.
 * Green/amber/red are reserved for terminal outcomes; in-flight states use the neutral/brand ramp so
 * a status colour never reads as the brand.
 */
const MAP: Record<
  MessageStatus,
  { label: string; icon: LucideIcon; cls: string }
> = {
  queued: {
    label: "Queued",
    icon: Clock,
    cls: "bg-muted text-muted-foreground",
  },
  sending: {
    label: "Sending",
    icon: Loader,
    cls: "bg-primary/10 text-primary",
  },
  accepted: {
    label: "Accepted",
    icon: Check,
    cls: "bg-primary/10 text-primary",
  },
  sent: { label: "Sent", icon: Send, cls: "bg-primary/10 text-primary" },
  delivered: {
    label: "Delivered",
    icon: CheckCheck,
    cls: "bg-success/12 text-success",
  },
  undelivered: {
    label: "Undelivered",
    icon: TriangleAlert,
    cls: "bg-warning/15 text-warning-strong",
  },
  failed: {
    label: "Failed",
    icon: XCircle,
    cls: "bg-destructive/12 text-destructive",
  },
  expired: {
    label: "Expired",
    icon: Clock,
    cls: "bg-muted text-muted-foreground",
  },
};

export function StatusBadge({ status }: { status: MessageStatus }) {
  const { label, icon: Icon, cls } = MAP[status];
  return (
    <Badge variant="outline" className={cn("gap-1 border-transparent", cls)}>
      <Icon />
      {label}
    </Badge>
  );
}
