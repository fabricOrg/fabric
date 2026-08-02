import {
  StatusBadge as Base,
  type StatusTone,
} from "@app/ui/components/ui/status-badge";
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
 * The message lifecycle's vocabulary. Only the mapping lives here — the styling is the shared
 * `StatusBadge`'s single tone table, so this can never drift from the other status surfaces.
 *
 * Green/amber/red stay reserved for terminal outcomes; in-flight states take `info` so a status
 * colour never reads as the brand.
 */
const MAP: Record<
  MessageStatus,
  { label: string; icon: LucideIcon; tone: StatusTone }
> = {
  queued: { label: "Queued", icon: Clock, tone: "neutral" },
  sending: { label: "Sending", icon: Loader, tone: "info" },
  accepted: { label: "Accepted", icon: Check, tone: "info" },
  sent: { label: "Sent", icon: Send, tone: "info" },
  delivered: { label: "Delivered", icon: CheckCheck, tone: "success" },
  undelivered: {
    label: "Undelivered",
    icon: TriangleAlert,
    tone: "warning",
  },
  failed: { label: "Failed", icon: XCircle, tone: "danger" },
  expired: { label: "Expired", icon: Clock, tone: "neutral" },
};

export function StatusBadge({ status }: { status: MessageStatus }) {
  const { label, icon, tone } = MAP[status];
  return <Base tone={tone} label={label} icon={icon} />;
}
