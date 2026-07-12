"use client";

import type { VirtualPhoneInbox } from "@app/contracts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@app/ui/components/ui/alert";
import { Button } from "@app/ui/components/ui/button";
import {
  EmptyState,
  ErrorState,
  LoadingRows,
} from "@app/ui/components/ui/states";
import { cn } from "@app/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, Smartphone } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { Handset } from "@/components/virtual-phone/handset";
import { MessageInspector } from "@/components/virtual-phone/message-inspector";
import { ThreadRail } from "@/components/virtual-phone/thread-rail";
import {
  getMessagingSettings,
  getVirtualPhone,
  markVirtualMessageRead,
} from "@/lib/client/dashboard-api";
import {
  groupVirtualThreads,
  type VirtualThread,
} from "@/lib/virtual-phone/threads";

const INBOX_KEY = ["virtual-phone-inbox"] as const;

export default function VirtualPhonePage() {
  const settingsQuery = useQuery({
    queryKey: ["messaging-settings"],
    queryFn: getMessagingSettings,
  });
  const settings = settingsQuery.data;
  const queryClient = useQueryClient();
  const [selectedKey, setSelectedKey] = useState<string>();
  const [selectedMessageId, setSelectedMessageId] = useState<string>();
  const [query, setQuery] = useState("");

  // TanStack Query owns the polling (CLAUDE.md §4): it dedupes in-flight requests, pauses while the
  // tab is hidden, and keeps the last good page on screen during a refetch — all of which the
  // hand-rolled setInterval had to fake, and the "keep last good data" part it never did.
  const inboxQuery = useQuery({
    queryKey: INBOX_KEY,
    queryFn: getVirtualPhone,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    placeholderData: (previous) => previous,
  });
  const messages = inboxQuery.data?.messages ?? null;
  const error = inboxQuery.isError ? errorMessage(inboxQuery.error) : null;
  const reload = useCallback(
    () => queryClient.invalidateQueries({ queryKey: INBOX_KEY }),
    [queryClient],
  );

  const threads = useMemo(
    () => groupVirtualThreads(messages ?? []),
    [messages],
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? threads.filter((thread) =>
          `${thread.to} ${thread.from} ${thread.messages.map((message) => message.body).join(" ")}`
            .toLowerCase()
            .includes(needle),
        )
      : threads;
  }, [query, threads]);
  const selectedThread = threads.find((thread) => thread.key === selectedKey);
  const selectedMessage =
    messages?.find((message) => message.id === selectedMessageId) ??
    selectedThread?.lastMessage;

  function selectThread(thread: VirtualThread) {
    setSelectedKey(thread.key);
    setSelectedMessageId(thread.lastMessage.id);
    const unread = thread.messages.filter(
      (message) => message.read_at === null,
    );
    if (unread.length === 0) return;

    // Optimistic: mark read in the cache immediately so the badge clears on tap, then reconcile.
    const readAt = new Date().toISOString();
    queryClient.setQueryData<VirtualPhoneInbox>(INBOX_KEY, (current) =>
      current
        ? {
            messages: current.messages.map((message) =>
              unread.some((item) => item.id === message.id)
                ? { ...message, read_at: readAt }
                : message,
            ),
          }
        : current,
    );
    void Promise.all(
      unread.map((message) => markVirtualMessageRead(message.id)),
    ).catch(() => void reload());
  }

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <h1 className="font-display text-2xl font-semibold">Virtual phone</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Receive and inspect test SMS exactly where a carrier delivery would
            land.
          </p>
        </div>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : null}
      {settings?.delivery_mode === "live" ? (
        <Alert>
          <Info />
          <AlertTitle>Live carrier delivery is enabled</AlertTitle>
          <AlertDescription>
            New sends go to the carrier. The conversations below are historical
            virtual deliveries.
          </AlertDescription>
        </Alert>
      ) : null}

      {messages === null ? (
        <LoadingRows rows={6} className="rounded-md border p-4" />
      ) : messages.length === 0 ? (
        <EmptyState
          icon={<Smartphone />}
          title="Your virtual phone is ready"
          description="Send an SMS in virtual mode and it will appear here as a real conversation."
          action={
            <Button asChild>
              <Link href="/send">Send a test SMS</Link>
            </Button>
          }
          className="min-h-[32rem] rounded-md border bg-card"
        />
      ) : (
        <div
          className={cn(
            "min-h-[38rem] overflow-hidden rounded-md border bg-background lg:flex",
            selectedThread ? "block" : "grid",
          )}
        >
          <div className={cn("lg:block", selectedThread && "hidden")}>
            <ThreadRail
              threads={filtered}
              selected={selectedKey}
              query={query}
              onQuery={setQuery}
              onSelect={selectThread}
            />
          </div>
          <div
            className={cn(
              "min-w-0 flex-1 lg:flex",
              !selectedThread && "hidden lg:flex",
            )}
          >
            <Handset
              thread={selectedThread}
              onBack={() => setSelectedKey(undefined)}
              onSelectMessage={setSelectedMessageId}
            />
            <MessageInspector message={selectedMessage} />
          </div>
        </div>
      )}
    </div>
  );
}

function errorMessage(cause: unknown): string {
  if (typeof cause === "object" && cause && "error" in cause) {
    const error = (cause as { error?: { message?: unknown } }).error;
    if (typeof error?.message === "string") return error.message;
  }
  return "Virtual phone data could not be loaded.";
}
