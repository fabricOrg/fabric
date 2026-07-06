"use client";

import { Badge } from "@app/ui/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@app/ui/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@app/ui/components/ui/table";
import { cn } from "@app/ui/lib/utils";
import {
  CheckCheck,
  Clock,
  type LucideIcon,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import type {
  Verification,
  VerifyChannelName,
  VerifyStatus,
} from "@/lib/client/verify-api";

const CHANNEL_META: Record<
  VerifyChannelName,
  { label: string; icon: LucideIcon }
> = {
  sms: { label: "SMS", icon: MessageSquare },
  voice: { label: "Voice", icon: Phone },
  whatsapp: { label: "WhatsApp", icon: MessageCircle },
  email: { label: "Email", icon: Mail },
};

/** Colour is never the only signal (WCAG): each state pairs a token with an icon + label. */
const STATUS_META: Record<
  VerifyStatus,
  { label: string; icon: LucideIcon; cls: string }
> = {
  pending: { label: "Pending", icon: Clock, cls: "bg-primary/10 text-primary" },
  verified: {
    label: "Verified",
    icon: CheckCheck,
    cls: "bg-success/12 text-success",
  },
  expired: {
    label: "Expired",
    icon: Clock,
    cls: "bg-muted text-muted-foreground",
  },
  failed: {
    label: "Failed",
    icon: XCircle,
    cls: "bg-destructive/12 text-destructive",
  },
};

const CHANNELS: readonly VerifyChannelName[] = [
  "sms",
  "voice",
  "whatsapp",
  "email",
];
const STATUSES: readonly VerifyStatus[] = [
  "pending",
  "verified",
  "expired",
  "failed",
];

function ChannelBadge({ channel }: { channel: VerifyChannelName }) {
  const { label, icon: Icon } = CHANNEL_META[channel];
  return (
    <Badge variant="outline" className="gap-1">
      <Icon />
      {label}
    </Badge>
  );
}

function VerifyStatusBadge({ status }: { status: VerifyStatus }) {
  const { label, icon: Icon, cls } = STATUS_META[status];
  return (
    <Badge variant="outline" className={cn("gap-1 border-transparent", cls)}>
      <Icon />
      {label}
    </Badge>
  );
}

export function VerificationLog({
  verifications,
}: {
  verifications: readonly Verification[];
}) {
  const [channel, setChannel] = useState<VerifyChannelName | "all">("all");
  const [status, setStatus] = useState<VerifyStatus | "all">("all");

  if (verifications.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldCheck />
          </EmptyMedia>
          <EmptyTitle>No verifications yet</EmptyTitle>
          <EmptyDescription>
            Send a test code above, or call the Verify API — attempts show up
            here in real time.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const filtered = verifications.filter(
    (v) =>
      (channel === "all" || v.channel === channel) &&
      (status === "all" || v.status === status),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select
          value={channel}
          onValueChange={(v) => setChannel(v as VerifyChannelName | "all")}
        >
          <SelectTrigger className="sm:w-44" aria-label="Filter by channel">
            <SelectValue placeholder="All channels" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All channels</SelectItem>
            {CHANNELS.map((c) => (
              <SelectItem key={c} value={c}>
                {CHANNEL_META[c].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as VerifyStatus | "all")}
        >
          <SelectTrigger className="sm:w-44" aria-label="Filter by status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_META[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Semantic <section> keeps the wide table's scroll region keyboard-focusable (WCAG 2.1.1). */}
      <section
        className="overflow-x-auto"
        tabIndex={0}
        aria-label="Recent verifications"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Recipient</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-mono text-sm">{v.msisdn}</TableCell>
                <TableCell>
                  <ChannelBadge channel={v.channel} />
                </TableCell>
                <TableCell>
                  <VerifyStatusBadge status={v.status} />
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {new Date(v.createdAt).toLocaleString("en", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {filtered.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            No verifications match this filter.
          </p>
        ) : null}
      </section>
    </div>
  );
}
