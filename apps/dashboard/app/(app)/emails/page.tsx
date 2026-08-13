"use client";

import type { EmailContentResponse, EmailMessage } from "@app/contracts";
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
import { TablePagination } from "@app/ui/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@app/ui/components/ui/dialog";
import {
  LoadingRows,
  TableEmptyState,
  TableLoadingState,
} from "@app/ui/components/ui/states";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@app/ui/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@app/ui/components/ui/tabs";
import { WorkflowHeader } from "@app/ui/components/ui/workflow-header";
import { formatDateTimeFull } from "@app/ui/lib/datetime";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { Mail, RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { StatusBadge } from "@/components/status-badge";

type EmailFilter = "all" | "queued" | "delivered" | "failed";

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = (await response.json()) as unknown;
  if (!response.ok) throw data;
  return data as T;
}

export default function EmailsPage() {
  const [selected, setSelected] = useState<EmailMessage | null>(null);
  const [emailFilter, setEmailFilter] = useState<EmailFilter>("all");
  const emails = useQuery({
    queryKey: ["emails"],
    queryFn: () =>
      fetchJson<{ messages: EmailMessage[] }>("/api/dashboard/emails"),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });

  return (
    <div className="flex w-full flex-col gap-6">
      <WorkflowHeader
        title="Emails"
        description="Review delivered content and provider outcomes."
        actions={
          <>
            <EmailActivitySummary state={emails} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void emails.refetch()}
              loading={emails.isRefetching}
            >
              {emails.isRefetching ? null : (
                <RefreshCw data-icon="inline-start" />
              )}
              Refresh
            </Button>
          </>
        }
      />

      {emails.isError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Couldn&apos;t load emails</AlertTitle>
          <AlertDescription>
            <p>Something went wrong reaching the API. Try again shortly.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => emails.refetch()}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : emails.isPending ? (
        <TableLoadingState />
      ) : emails.data.messages.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Sent emails</CardTitle>
          </CardHeader>
          <CardContent>
            <TableEmptyState
              title="No emails yet"
              description="Send from the SDK, API, or playground."
              action={
                <Button size="sm" variant="outline" asChild>
                  <Link href="/applications">Open applications</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">Sent emails</CardTitle>
            <EmailStatusTabs
              value={emailFilter}
              onValueChange={setEmailFilter}
            />
          </CardHeader>
          <CardContent>
            <EmailTable
              key={emailFilter}
              messages={filterEmailMessages(emails.data.messages, emailFilter)}
              filter={emailFilter}
              onSelect={setSelected}
              onClearFilter={() => setEmailFilter("all")}
            />
          </CardContent>
        </Card>
      )}

      <EmailContentDialog
        message={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </div>
  );
}

function EmailStatusTabs({
  value,
  onValueChange,
}: {
  value: EmailFilter;
  onValueChange: (value: EmailFilter) => void;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => onValueChange(next as EmailFilter)}
    >
      <TabsList>
        <TabsTrigger value="all">All</TabsTrigger>
        <TabsTrigger value="queued">Queued</TabsTrigger>
        <TabsTrigger value="delivered">Delivered</TabsTrigger>
        <TabsTrigger value="failed">Failed</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

function EmailTable({
  messages,
  filter,
  onSelect,
  onClearFilter,
}: {
  messages: readonly EmailMessage[];
  filter: EmailFilter;
  onSelect: (message: EmailMessage) => void;
  onClearFilter: () => void;
}) {
  const pageSize = 10;
  const [pageIndex, setPageIndex] = useState(0);
  const pageCount = Math.max(1, Math.ceil(messages.length / pageSize));
  const visibleMessages = useMemo(
    () => messages.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize),
    [messages, pageIndex],
  );

  if (messages.length === 0) {
    return (
      <TableEmptyState
        title={`No ${filter} emails`}
        description="Try another status filter."
        filtered
        action={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onClearFilter}
          >
            Show all
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <section className="overflow-x-auto" tabIndex={0} aria-label="Emails">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Recipient</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Sent</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleMessages.map((message) => (
              <TableRow
                key={message.id}
                className="cursor-pointer"
                onClick={() => onSelect(message)}
              >
                <TableCell className="font-mono text-xs">
                  {message.to}
                </TableCell>
                <TableCell className="max-w-xs truncate">
                  {message.subject}
                </TableCell>
                <TableCell>
                  <StatusBadge status={message.status} />
                </TableCell>
                <TableCell className="text-right text-muted-foreground text-xs">
                  {formatDateTimeFull(message.created_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      {messages.length > pageSize ? (
        <TablePagination
          pageIndex={pageIndex}
          pageCount={pageCount}
          rowCount={messages.length}
          pageSize={pageSize}
          onFirst={() => setPageIndex(0)}
          onPrevious={() => setPageIndex((page) => Math.max(0, page - 1))}
          onNext={() =>
            setPageIndex((page) => Math.min(pageCount - 1, page + 1))
          }
          onLast={() => setPageIndex(pageCount - 1)}
          canPrevious={pageIndex > 0}
          canNext={pageIndex < pageCount - 1}
        />
      ) : null}
    </div>
  );
}

function EmailActivitySummary({
  state,
}: {
  state: UseQueryResult<{ messages: EmailMessage[] }>;
}) {
  if (state.isError) {
    return (
      <CompactSummary
        label="Activity"
        summary="Unavailable"
        title="Recent email activity"
        icon={Mail}
      >
        <div className="p-4 text-destructive text-sm">
          Email activity could not be loaded.
        </div>
      </CompactSummary>
    );
  }

  if (state.isPending) {
    return (
      <CompactSummary
        label="Activity"
        summary="Loading"
        title="Recent email activity"
        icon={Mail}
      >
        <div className="p-4 text-muted-foreground text-sm">
          Loading recent emails...
        </div>
      </CompactSummary>
    );
  }

  const stats = emailStats(state.data.messages);

  return (
    <CompactSummary
      label="Activity"
      summary={`${stats.total} recent`}
      title="Recent email activity"
      icon={Mail}
    >
      <CompactSummaryRows>
        <CompactSummaryRow label="Total" value={stats.total} />
        <CompactSummaryRow label="Queued" value={stats.queued} />
        <CompactSummaryRow label="Delivered" value={stats.delivered} />
        <CompactSummaryRow label="Failed" value={stats.failed} />
      </CompactSummaryRows>
    </CompactSummary>
  );
}

function emailStats(messages: readonly EmailMessage[]) {
  return messages.reduce(
    (stats, message) => {
      stats.total += 1;
      if (message.status === "delivered") {
        stats.delivered += 1;
      } else if (message.status === "failed") {
        stats.failed += 1;
      } else {
        stats.queued += 1;
      }
      return stats;
    },
    { delivered: 0, failed: 0, queued: 0, total: 0 },
  );
}

function filterEmailMessages(
  messages: readonly EmailMessage[],
  filter: EmailFilter,
) {
  if (filter === "all") return messages;
  if (filter === "queued") {
    return messages.filter(
      (message) =>
        message.status !== "delivered" && message.status !== "failed",
    );
  }
  return messages.filter((message) => message.status === filter);
}

function EmailContentDialog({
  message,
  onOpenChange,
}: {
  message: EmailMessage | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isPending } = useQuery({
    queryKey: ["email-content", message?.id],
    queryFn: () =>
      fetchJson<EmailContentResponse>(
        `/api/dashboard/emails/${encodeURIComponent(message?.id ?? "")}/content`,
      ),
    enabled: message !== null,
  });

  return (
    <Dialog open={message !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate">
            {message?.subject ?? "Email"}
          </DialogTitle>
          <DialogDescription>
            To <span className="font-mono">{message?.to}</span> from{" "}
            <span className="font-mono">{message?.from}</span>
          </DialogDescription>
        </DialogHeader>
        {message ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3 text-muted-foreground text-sm">
              <StatusBadge status={message.status} />
              <span>{formatDateTimeFull(message.created_at)}</span>
              <span>{message.provider}</span>
              {message.error_code ? (
                <span className="text-destructive">{message.error_code}</span>
              ) : null}
            </div>

            {isPending ? (
              <LoadingRows rows={3} />
            ) : data?.erased ? (
              <div className="rounded-lg border bg-muted/40 p-4 text-muted-foreground text-sm italic">
                Recipient data erased.
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {data?.html ? (
                  <div>
                    <p className="mb-1 text-muted-foreground text-xs">
                      HTML preview
                    </p>
                    {/* Fully sandboxed: customer HTML is untrusted. */}
                    <iframe
                      title="Email HTML preview"
                      sandbox=""
                      srcDoc={data.html}
                      className="h-80 w-full rounded-lg border bg-white"
                    />
                  </div>
                ) : null}
                {data?.text ? (
                  <div>
                    <p className="mb-1 text-muted-foreground text-xs">Text</p>
                    <pre className="max-h-64 overflow-auto rounded-lg border bg-muted/40 p-4 text-sm whitespace-pre-wrap">
                      {data.text}
                    </pre>
                  </div>
                ) : null}
                {!data?.html && !data?.text ? (
                  <p className="text-muted-foreground text-sm">
                    No content to display.
                  </p>
                ) : null}
              </div>
            )}

            <div className="flex items-center gap-1 text-muted-foreground text-xs">
              <span>ID</span>
              <code className="text-xs">{message.id}</code>
              <CopyButton
                value={message.id}
                toastLabel="Email ID copied"
                ariaLabel="Copy email ID"
                className="size-6"
              />
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
