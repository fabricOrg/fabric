"use client";

import { Badge } from "@app/ui/components/ui/badge";
import { Progress } from "@app/ui/components/ui/progress";
import { Separator } from "@app/ui/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@app/ui/components/ui/sheet";
import { cn } from "@app/ui/lib/utils";
import {
  CheckCircle2,
  FileText,
  Loader,
  type LucideIcon,
  Send,
  TriangleAlert,
} from "lucide-react";
import type { Campaign, CampaignStatus } from "@/lib/client/campaigns-api";
import { formatMoney } from "@/lib/money";

/**
 * Campaign status chip. Colour is never the only signal (WCAG): each state pairs a semantic token
 * with an icon + label. Terminal outcomes use success/destructive; in-flight/pre-send use the
 * neutral/brand ramp so a status colour never reads as the brand itself. Hosted here (a leaf module)
 * and imported by the table to keep the two component files free of a circular import.
 */
const STATUS_MAP: Record<
  CampaignStatus,
  { label: string; icon: LucideIcon; cls: string }
> = {
  draft: {
    label: "Draft",
    icon: FileText,
    cls: "bg-muted text-muted-foreground",
  },
  scheduled: {
    label: "Scheduled",
    icon: Loader,
    cls: "bg-primary/10 text-primary",
  },
  sending: { label: "Sending", icon: Send, cls: "bg-primary/10 text-primary" },
  completed: {
    label: "Completed",
    icon: CheckCircle2,
    cls: "bg-success/12 text-success",
  },
  failed: {
    label: "Failed",
    icon: TriangleAlert,
    cls: "bg-destructive/12 text-destructive",
  },
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const { label, icon: Icon, cls } = STATUS_MAP[status];
  return (
    <Badge variant="outline" className={cn("gap-1 border-transparent", cls)}>
      <Icon />
      {label}
    </Badge>
  );
}

const numberFmt = new Intl.NumberFormat("en-US");

/** delivered / sent as a whole-percent string; guards divide-by-zero for pre-send campaigns. */
function rate(numerator: number, denominator: number): string {
  if (denominator <= 0) return "—";
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function StatRow({
  label,
  count,
  total,
  tone,
}: {
  label: string;
  count: number;
  total: number;
  tone: "success" | "destructive" | "muted";
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const toneCls =
    tone === "success"
      ? "text-success"
      : tone === "destructive"
        ? "text-destructive"
        : "text-muted-foreground";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-mono tabular-nums ${toneCls}`}>
          {numberFmt.format(count)}
          <span className="ml-1 text-xs text-muted-foreground">({pct}%)</span>
        </span>
      </div>
      <Progress value={pct} aria-label={`${label}: ${pct}%`} />
    </div>
  );
}

export function CampaignDetailSheet({
  campaign,
  onClose,
}: {
  campaign: Campaign | null;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={campaign !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="font-display">
            {campaign?.name ?? "Campaign"}
          </SheetTitle>
          <SheetDescription>
            {campaign
              ? `${numberFmt.format(campaign.audienceSize)} recipients · ${
                  campaign.scheduledAt ? "scheduled" : "immediate"
                }`
              : ""}
          </SheetDescription>
        </SheetHeader>

        {campaign && (
          <div className="flex flex-col gap-6 px-4 pb-6">
            <div className="flex flex-wrap items-center gap-2">
              <CampaignStatusBadge status={campaign.status} />
              <Badge variant="secondary" className="font-mono">
                est. {formatMoney(campaign.costEstimate)}
              </Badge>
            </div>

            {/* Headline delivery rate — the single number that tells you if the campaign landed. */}
            <div className="flex flex-col gap-1 rounded-lg border p-4">
              <span className="text-xs font-medium text-muted-foreground">
                Delivery rate
              </span>
              <span className="font-display text-3xl tabular-nums">
                {rate(campaign.delivered, campaign.sent)}
              </span>
              <span className="text-xs text-muted-foreground">
                {numberFmt.format(campaign.delivered)} delivered of{" "}
                {numberFmt.format(campaign.sent)} sent
              </span>
            </div>

            <div className="flex flex-col gap-4">
              <span className="text-xs font-medium text-muted-foreground">
                Breakdown
              </span>
              <StatRow
                label="Delivered"
                count={campaign.delivered}
                total={campaign.sent}
                tone="success"
              />
              <StatRow
                label="Failed"
                count={campaign.failed}
                total={campaign.sent}
                tone="destructive"
              />
              <StatRow
                label="Opted out"
                count={campaign.optedOut}
                total={campaign.audienceSize}
                tone="muted"
              />
            </div>

            <Separator />

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                Message
              </span>
              <p className="text-sm">
                {campaign.body ? (
                  campaign.body
                ) : (
                  <span className="italic text-muted-foreground">
                    No message body yet (draft).
                  </span>
                )}
              </p>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
