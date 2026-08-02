import type { VirtualPhoneMessage } from "@app/contracts";
import { Button } from "@app/ui/components/ui/button";
import { Input } from "@app/ui/components/ui/input";
import {
  formatDateTimeFull,
  formatTime,
  formatWeekdayDate,
} from "@app/ui/lib/datetime";
import {
  ArrowLeft,
  Info,
  Maximize2,
  MessageSquareText,
  MoreVertical,
  Send,
} from "lucide-react";
import { useState } from "react";
import type { VirtualThread } from "@/lib/virtual-phone/threads";
import { MessageDialog } from "./message-dialog";

export function Handset({
  thread,
  onBack,
  onSelectMessage,
  onReply,
  liveDelivery = false,
}: {
  thread?: VirtualThread;
  onBack: () => void;
  onSelectMessage: (id: string) => void;
  onReply: (to: string, body: string) => Promise<boolean>;
  /**
   * The workspace delivers to a real carrier, so these threads are HISTORY and the composer must not
   * be offered. A reply box under a message that arrived on a real handset reads as "answer this
   * text" — and a real recipient cannot reply at all: sends go out from an alphanumeric sender ID
   * (AKWAAH), which has no number to reply to, and Fabric has no inbound (MO) route either. The
   * composer only ever simulated an inbound to the virtual number, which is useful in sandbox and
   * meaningless here.
   */
  liveDelivery?: boolean;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [expanded, setExpanded] = useState<VirtualPhoneMessage | null>(null);

  async function submit() {
    if (!thread || body.trim().length === 0 || sending) return;
    setSending(true);
    try {
      if (await onReply(thread.to, body.trim())) setBody("");
    } finally {
      setSending(false);
    }
  }
  return (
    <section className="flex min-h-[36rem] min-w-0 flex-1 justify-center bg-muted/30 p-0 lg:p-6">
      <div className="flex h-[min(46rem,calc(100vh-12rem))] min-h-[34rem] w-full max-w-md flex-col overflow-hidden bg-background shadow-sm lg:rounded-[2rem] lg:border-[6px] lg:border-foreground/90">
        <div
          className="hidden h-7 shrink-0 items-center justify-between bg-foreground px-5 text-[10px] text-background lg:flex"
          aria-hidden
        >
          <span>Fabric</span>
          <span>Virtual · 100%</span>
        </div>
        {thread ? (
          <>
            <header className="flex h-16 shrink-0 items-center gap-2 border-b px-2">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={onBack}
                aria-label="Back to conversations"
              >
                <ArrowLeft />
              </Button>
              <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 font-medium text-primary">
                {thread.from.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-semibold">
                  {thread.from}
                </h2>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  To {thread.to}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Conversation options"
                disabled
              >
                <MoreVertical />
              </Button>
            </header>
            <div
              className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-muted/25 p-4"
              role="log"
              aria-live="polite"
              aria-relevant="additions"
            >
              {thread.messages.map((message, index) => (
                <div key={message.id}>
                  {showDay(thread, index) ? (
                    <p className="my-3 text-center text-[11px] font-medium text-muted-foreground">
                      {formatWeekdayDate(message.created_at)}
                    </p>
                  ) : null}
                  <div
                    className={`flex ${message.direction === "inbound" ? "justify-end" : "justify-start"}`}
                  >
                    <div className="group/msg relative max-w-[85%]">
                      <button
                        type="button"
                        onClick={() => onSelectMessage(message.id)}
                        className={`block w-full rounded-2xl px-3.5 py-2.5 text-left shadow-sm outline-none ring-border hover:ring-1 focus-visible:ring-2 focus-visible:ring-ring ${message.direction === "inbound" ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-card"}`}
                      >
                        <span className="sr-only">
                          From {message.from}, {message.status}, at{" "}
                          {formatDateTimeFull(message.created_at)}.
                        </span>
                        <span className="block whitespace-pre-wrap text-sm leading-5">
                          {message.body}
                        </span>
                        <span className="mt-1 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
                          <time dateTime={message.created_at}>
                            {formatTime(message.created_at)}
                          </time>
                          <span>·</span>
                          <span>{message.status}</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setExpanded(message)}
                        aria-label="Expand message"
                        title="Expand message"
                        className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none group-hover/msg:opacity-100"
                      >
                        <Maximize2 className="size-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {liveDelivery ? (
              <div className="flex shrink-0 items-center gap-2 border-t bg-background px-3 py-3 text-muted-foreground text-xs">
                <Info className="size-3.5 shrink-0" />
                <span>
                  No replies while live delivery is on — these are past virtual
                  deliveries, and a real recipient can&apos;t reply to an
                  alphanumeric sender ID.
                </span>
              </div>
            ) : (
              <div className="flex h-16 shrink-0 items-center gap-2 border-t bg-background px-3">
                <Input
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void submit();
                    }
                  }}
                  placeholder="Reply as this phone (try STOP)"
                  aria-label="Virtual phone reply"
                  disabled={sending}
                />
                <Button
                  size="icon"
                  onClick={() => void submit()}
                  disabled={sending || body.trim().length === 0}
                  aria-label="Send virtual reply"
                >
                  <Send />
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <MessageSquareText className="size-10 text-muted-foreground" />
            <div>
              <h2 className="font-medium">Select a conversation</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Open a thread to inspect messages delivered to this virtual
                device.
              </p>
            </div>
          </div>
        )}
      </div>
      <MessageDialog
        message={expanded ?? undefined}
        open={expanded !== null}
        onOpenChange={(open) => {
          if (!open) setExpanded(null);
        }}
      />
    </section>
  );
}

function showDay(thread: VirtualThread, index: number) {
  if (index === 0) return true;
  return (
    new Date(thread.messages[index - 1]?.created_at ?? 0).toDateString() !==
    new Date(thread.messages[index]?.created_at ?? 0).toDateString()
  );
}
