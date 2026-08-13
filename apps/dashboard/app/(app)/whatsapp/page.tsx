"use client";

import {
  type MessageStatusGroup,
  messageStatusGroupOf,
  parseApiError,
  type WhatsappMessageListResponse,
  whatsappMessageListResponse,
} from "@app/contracts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@app/ui/components/ui/alert";
import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import {
  CompactSummary,
  CompactSummaryRow,
  CompactSummaryRows,
} from "@app/ui/components/ui/compact-summary";
import { CursorPagination } from "@app/ui/components/ui/data-table";
import {
  TableEmptyState,
  TableLoadingState,
} from "@app/ui/components/ui/states";
import { Tabs, TabsList, TabsTrigger } from "@app/ui/components/ui/tabs";
import { WorkflowHeader } from "@app/ui/components/ui/workflow-header";
import { useCursorPagination } from "@app/ui/hooks/use-cursor-pagination";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { WhatsappSendForm } from "@/components/forms/whatsapp-send-form";
import { WhatsappMessagesTable } from "@/components/tables/whatsapp-messages-table";

type MessageFilter = "all" | MessageStatusGroup;
const PAGE_SIZE = 20;

async function fetchWhatsappMessages(
  cursor: string | null,
  filter: MessageFilter,
): Promise<WhatsappMessageListResponse> {
  const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor) query.set("cursor", cursor);
  if (filter !== "all") query.set("status", filter);
  const response = await fetch(`/api/dashboard/whatsapp?${query.toString()}`);
  const payload: unknown = await response.json();
  if (!response.ok) throw payload;
  return whatsappMessageListResponse.parse(payload);
}

export default function WhatsappPage() {
  const queryClient = useQueryClient();
  const [messageFilter, setMessageFilter] = useState<MessageFilter>("all");
  const pagination = useCursorPagination();
  const activity = useQuery({
    queryKey: ["whatsapp-messages", "all", null],
    queryFn: () => fetchWhatsappMessages(null, "all"),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
  const messages = useQuery({
    queryKey: ["whatsapp-messages", messageFilter, pagination.cursor],
    queryFn: () => fetchWhatsappMessages(pagination.cursor, messageFilter),
    refetchInterval: pagination.pageIndex === 0 ? 15_000 : false,
    refetchIntervalInBackground: false,
  });

  function messageList() {
    if (messages.isError) {
      const err = parseApiError(messages.error);
      return (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Couldn&apos;t load WhatsApp messages</AlertTitle>
          <AlertDescription>
            <p>{err.message}</p>
            {err.requestId ? (
              <p>
                Contact support with{" "}
                <code className="font-mono">{err.requestId}</code>.
              </p>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => messages.refetch()}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      );
    }

    if (messages.isPending) {
      return <TableLoadingState />;
    }

    if (
      messages.data.messages.length === 0 &&
      pagination.pageIndex === 0 &&
      messageFilter === "all"
    ) {
      return (
        <TableEmptyState
          title="No WhatsApp messages yet"
          description="Send a template to create the first delivery record."
          action={
            <Button
              size="sm"
              onClick={() => document.getElementById("whatsapp-to")?.focus()}
            >
              Send template
            </Button>
          }
        />
      );
    }

    const pager =
      pagination.canPrevious || messages.data.next_cursor ? (
        <CursorPagination
          pageIndex={pagination.pageIndex}
          rowCount={messages.data.messages.length}
          pageSize={PAGE_SIZE}
          onPrevious={pagination.previous}
          onNext={() => {
            if (messages.data.next_cursor) {
              pagination.next(messages.data.next_cursor);
            }
          }}
          canPrevious={pagination.canPrevious}
          canNext={messages.data.next_cursor !== null}
        />
      ) : null;

    if (messages.data.messages.length === 0) {
      return (
        <div className="flex flex-col gap-3">
          <TableEmptyState
            title={`No ${messageFilter} messages on this page`}
            description="Try another page or status."
            filtered
            action={
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  pagination.reset();
                  setMessageFilter("all");
                }}
              >
                Show all
              </Button>
            }
          />
          {pager}
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-3">
        <WhatsappMessagesTable messages={messages.data.messages} />
        {pager}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <WorkflowHeader
        title="WhatsApp"
        description="Send approved templates and monitor delivery outcomes."
        actions={
          <>
            <WhatsappActivitySummary state={activity} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void messages.refetch()}
              loading={messages.isRefetching}
            >
              {messages.isRefetching ? null : (
                <RefreshCw data-icon="inline-start" />
              )}
              Refresh
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Send template</CardTitle>
        </CardHeader>
        <CardContent>
          <WhatsappSendForm
            onSent={() => {
              void queryClient.invalidateQueries({
                queryKey: ["whatsapp-messages"],
              });
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Message log</CardTitle>
          <MessageStatusTabs
            value={messageFilter}
            onValueChange={(filter) => {
              pagination.reset();
              setMessageFilter(filter);
            }}
          />
        </CardHeader>
        <CardContent>{messageList()}</CardContent>
      </Card>
    </div>
  );
}

function MessageStatusTabs({
  value,
  onValueChange,
}: {
  value: MessageFilter;
  onValueChange: (value: MessageFilter) => void;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => onValueChange(next as MessageFilter)}
    >
      <TabsList>
        <TabsTrigger value="all">All</TabsTrigger>
        <TabsTrigger value="active">In progress</TabsTrigger>
        <TabsTrigger value="delivered">Delivered</TabsTrigger>
        <TabsTrigger value="failed">Failed</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

function WhatsappActivitySummary({
  state,
}: {
  state: ReturnType<typeof useQuery<WhatsappMessageListResponse>>;
}) {
  if (state.isError) {
    return (
      <CompactSummary
        label="Activity"
        summary="Unavailable"
        title="Recent WhatsApp activity"
        icon={MessageCircle}
      >
        <div className="p-4 text-destructive text-sm">
          Message activity could not be loaded.
        </div>
      </CompactSummary>
    );
  }

  if (state.isPending) {
    return (
      <CompactSummary
        label="Activity"
        summary="Loading"
        title="Recent WhatsApp activity"
        icon={MessageCircle}
      >
        <div className="p-4 text-muted-foreground text-sm">
          Loading recent messages...
        </div>
      </CompactSummary>
    );
  }

  const stats = whatsappStats(state.data.messages);

  return (
    <CompactSummary
      label="Activity"
      summary={`${stats.total} recent`}
      title="Recent WhatsApp activity"
      icon={MessageCircle}
    >
      <CompactSummaryRows>
        <CompactSummaryRow label="Total" value={stats.total} />
        <CompactSummaryRow label="In progress" value={stats.active} />
        <CompactSummaryRow label="Delivered" value={stats.delivered} />
        <CompactSummaryRow label="Failed" value={stats.failed} />
      </CompactSummaryRows>
    </CompactSummary>
  );
}

function whatsappStats(messages: WhatsappMessageListResponse["messages"]) {
  return messages.reduce(
    (stats, message) => {
      stats.total += 1;
      const group = messageStatusGroupOf(message.status);
      if (group === "delivered") {
        stats.delivered += 1;
      } else if (group === "failed") {
        stats.failed += 1;
      } else {
        stats.active += 1;
      }
      return stats;
    },
    { active: 0, delivered: 0, failed: 0, total: 0 },
  );
}
