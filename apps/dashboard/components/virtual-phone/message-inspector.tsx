import type { VirtualPhoneMessage } from "@app/contracts";
import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import { formatDateTimeFull } from "@app/ui/lib/datetime";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";

export function MessageInspector({
  message,
}: {
  message?: VirtualPhoneMessage;
}) {
  return (
    <aside className="hidden w-72 shrink-0 border-l bg-card p-4 xl:block">
      <h2 className="text-sm font-semibold">Message details</h2>
      {message ? (
        <dl className="mt-5 space-y-4 text-sm">
          <Detail label="Status">
            <Badge variant="outline">{message.status}</Badge>
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
          <Detail label="Segments">{message.segments}</Detail>
          <Detail label="Message ID">
            <span className="flex items-center gap-1">
              <code className="truncate text-xs">{message.id}</code>
              <CopyButton
                value={message.id}
                toastLabel="Message ID copied"
                ariaLabel="Copy message ID"
                className="size-7"
              />
            </span>
          </Detail>
          <Button variant="outline" size="sm" asChild>
            <Link
              href={`/messages?messageId=${encodeURIComponent(message.id)}`}
            >
              Open delivery record <ExternalLink />
            </Link>
          </Button>
        </dl>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          Select a message bubble to inspect its delivery record.
        </p>
      )}
    </aside>
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
