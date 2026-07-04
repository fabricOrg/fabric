import type { MessageSummary } from "@app/contracts";
import { parseApiError } from "@app/contracts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@app/ui/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@app/ui/components/ui/empty";
import { List, TriangleAlert } from "lucide-react";
import { MessagesTable } from "@/components/messages-table";
import { getMessageList } from "@/lib/server/dashboard-data";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">{children}</div>
  );
}

function PageHeader() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="font-display text-2xl font-semibold tracking-tight">
        Messages
      </h1>
      <p className="text-sm text-muted-foreground">
        Every send, its delivery status, and the full report timeline.
      </p>
    </div>
  );
}

export default async function MessagesPage() {
  let messages: readonly MessageSummary[];
  try {
    messages = (await getMessageList()).messages;
  } catch (payload) {
    const err = parseApiError(payload);
    return (
      <Shell>
        <PageHeader />
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Couldn&apos;t load your messages</AlertTitle>
          <AlertDescription>
            <p>{err.message}</p>
            {err.requestId && (
              <p>
                Contact support with{" "}
                <code className="font-mono">{err.requestId}</code>.
              </p>
            )}
          </AlertDescription>
        </Alert>
      </Shell>
    );
  }

  if (messages.length === 0) {
    return (
      <Shell>
        <PageHeader />
        <Empty className="mx-auto max-w-2xl">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <List />
            </EmptyMedia>
            <EmptyTitle>No messages yet</EmptyTitle>
            <EmptyDescription>
              Your sends will appear here with live delivery status. Head to
              Send SMS to get started.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Shell>
    );
  }

  return (
    <Shell>
      <PageHeader />
      <Card>
        <CardHeader>
          <CardTitle>Message log</CardTitle>
          <CardDescription>
            Filter by recipient or status; select a row for its delivery
            timeline.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MessagesTable messages={messages} />
        </CardContent>
      </Card>
    </Shell>
  );
}
