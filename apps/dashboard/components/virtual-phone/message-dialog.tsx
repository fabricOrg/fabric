"use client";

import type { VirtualPhoneMessage } from "@app/contracts";
import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@app/ui/components/ui/dialog";
import { formatDateTimeFull } from "@app/ui/lib/datetime";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";

/** Full-message view for a virtual-phone bubble — opened from the bubble's expand button. */
export function MessageDialog({
  message,
  open,
  onOpenChange,
}: {
  message?: VirtualPhoneMessage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Message</DialogTitle>
          <DialogDescription>
            Delivery record for this virtual-phone message.
          </DialogDescription>
        </DialogHeader>
        {message ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border bg-muted/40 p-4">
              {message.erased ? (
                <p className="text-sm text-muted-foreground italic">
                  [erased — the recipient's data was crypto-shredded]
                </p>
              ) : (
                <p className="text-sm leading-6 whitespace-pre-wrap">
                  {message.body}
                </p>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Detail label="Status">
                <Badge variant="outline" className="capitalize">
                  {message.status}
                </Badge>
              </Detail>
              <Detail label="Direction">
                <span className="capitalize">{message.direction}</span>
              </Detail>
              <Detail label="From">{message.from}</Detail>
              <Detail label="To">
                <span className="font-mono">{message.to}</span>
              </Detail>
              <Detail label="Received">
                <time dateTime={message.created_at}>
                  {formatDateTimeFull(message.created_at)}
                </time>
              </Detail>
              <Detail label="Read">
                {message.read_at
                  ? formatDateTimeFull(message.read_at)
                  : "Unread"}
              </Detail>
              <Detail label="Segments">{message.segments}</Detail>
            </dl>
            <div>
              <dt className="text-xs text-muted-foreground">Message ID</dt>
              <dd className="mt-1 flex items-center gap-1">
                <code className="truncate text-xs">{message.id}</code>
                <CopyButton
                  value={message.id}
                  toastLabel="Message ID copied"
                  ariaLabel="Copy message ID"
                  className="size-7 shrink-0"
                />
              </dd>
            </div>
            <Button variant="outline" size="sm" asChild className="w-fit">
              <Link
                href={`/messages?messageId=${encodeURIComponent(message.id)}`}
              >
                Open delivery record <ExternalLink />
              </Link>
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}
