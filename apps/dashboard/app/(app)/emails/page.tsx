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
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
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
import { formatDateTimeFull } from "@app/ui/lib/datetime";
import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { StatusBadge } from "@/components/status-badge";

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = (await response.json()) as unknown;
  if (!response.ok) throw data;
  return data as T;
}

export default function EmailsPage() {
  const [selected, setSelected] = useState<EmailMessage | null>(null);
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["emails"],
    queryFn: () =>
      fetchJson<{ messages: EmailMessage[] }>("/api/dashboard/emails"),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Emails
        </h1>
        <p className="text-sm text-muted-foreground">
          Every email sent from this workspace&apos;s current environment. Open
          one to read the delivered content.
        </p>
      </div>

      {isError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Couldn&apos;t load emails</AlertTitle>
          <AlertDescription>
            <p>Something went wrong reaching the API. Try again shortly.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : isPending ? (
        <TableLoadingState />
      ) : data.messages.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Sent emails</CardTitle>
            <CardDescription>
              Delivered email content and provider outcomes appear here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TableEmptyState
              title="No emails yet"
              description="Send one from the SDK, the API, or the playground and it appears here."
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sent emails</CardTitle>
          </CardHeader>
          <CardContent>
            <section
              className="overflow-x-auto"
              tabIndex={0}
              aria-label="Emails"
            >
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
                  {data.messages.map((message) => (
                    <TableRow
                      key={message.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(message)}
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
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {formatDateTimeFull(message.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
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
            To <span className="font-mono">{message?.to}</span> · from{" "}
            <span className="font-mono">{message?.from}</span>
          </DialogDescription>
        </DialogHeader>
        {message ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <StatusBadge status={message.status} />
              <span>{formatDateTimeFull(message.created_at)}</span>
              <span>· {message.provider}</span>
              {message.error_code ? (
                <span className="text-destructive">{message.error_code}</span>
              ) : null}
            </div>

            {isPending ? (
              <LoadingRows rows={3} />
            ) : data?.erased ? (
              <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground italic">
                [erased — the recipient&apos;s data was crypto-shredded]
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {data?.html ? (
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">
                      HTML preview
                    </p>
                    {/* Fully sandboxed (no scripts, no same-origin) — customer HTML is untrusted. */}
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
                    <p className="mb-1 text-xs text-muted-foreground">Text</p>
                    <pre className="max-h-64 overflow-auto rounded-lg border bg-muted/40 p-4 text-sm whitespace-pre-wrap">
                      {data.text}
                    </pre>
                  </div>
                ) : null}
                {!data?.html && !data?.text ? (
                  <p className="text-sm text-muted-foreground">
                    No content to display.
                  </p>
                ) : null}
              </div>
            )}

            <div className="flex items-center gap-1 text-xs text-muted-foreground">
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
