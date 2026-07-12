import { Input } from "@app/ui/components/ui/input";
import { cn } from "@app/ui/lib/utils";
import { Search } from "lucide-react";
import type { VirtualThread } from "@/lib/virtual-phone/threads";

export function ThreadRail({
  threads,
  selected,
  query,
  onQuery,
  onSelect,
}: {
  threads: VirtualThread[];
  selected?: string;
  query: string;
  onQuery: (value: string) => void;
  onSelect: (thread: VirtualThread) => void;
}) {
  return (
    <aside className="flex min-h-0 flex-col border-r bg-card lg:w-72">
      <div className="relative border-b p-3">
        <Search className="pointer-events-none absolute left-6 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search messages"
          className="pl-9"
        />
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        role="listbox"
        aria-label="Virtual phone conversations"
      >
        {threads.map((thread) => (
          <button
            key={thread.key}
            type="button"
            role="option"
            aria-selected={selected === thread.key}
            onClick={() => onSelect(thread)}
            className={cn(
              "flex min-h-20 w-full gap-3 border-b p-3 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              selected === thread.key && "bg-muted",
            )}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 font-medium text-primary">
              {thread.from.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <strong className="truncate text-sm">{thread.from}</strong>
                <time
                  className="shrink-0 text-xs text-muted-foreground"
                  dateTime={thread.lastMessage.created_at}
                >
                  {shortTime(thread.lastMessage.created_at)}
                </time>
              </span>
              <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">
                {thread.to}
              </span>
              <span className="mt-1 flex items-center justify-between gap-2">
                <span className="truncate text-xs text-muted-foreground">
                  {thread.lastMessage.body}
                </span>
                {thread.unread > 0 ? (
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                    {thread.unread}
                  </span>
                ) : null}
              </span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function shortTime(value: string) {
  const date = new Date(value);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}
