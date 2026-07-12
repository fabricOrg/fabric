import type { MessageSummary } from "@app/contracts";
import { parseApiError } from "@app/contracts";
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
import { TableEmptyState } from "@app/ui/components/ui/states";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@app/ui/components/ui/tabs";
import { Send, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { InsightsOverview } from "@/components/insights/insights-overview";
import { MessagesTable } from "@/components/tables/messages-table";
import { getMessageList } from "@/lib/server/dashboard-data";

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex w-full flex-col gap-6">{children}</div>;
}

function PageHeader() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="font-display text-2xl font-semibold tracking-tight">
        Messages
      </h1>
      <p className="text-sm text-muted-foreground">
        Every send, its delivery status, and the analytics behind them.
      </p>
    </div>
  );
}

/** The Log tab body — the real-BFF message log, with its error/empty/loaded states intact. */
function MessageLog({
  result,
  initialMessageId,
  initialStatus,
}: {
  result:
    | { kind: "error"; message: string; requestId?: string }
    | { kind: "messages"; messages: readonly MessageSummary[] };
  initialMessageId?: string;
  initialStatus?: MessageSummary["status"];
}) {
  if (result.kind === "error") {
    return (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>Couldn&apos;t load your messages</AlertTitle>
        <AlertDescription>
          <p>{result.message}</p>
          {result.requestId && (
            <p>
              Contact support with{" "}
              <code className="font-mono">{result.requestId}</code>.
            </p>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href="/messages">Retry</Link>
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (result.messages.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Message log</CardTitle>
          <CardDescription>
            Delivery records, provider outcomes, and message cost.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TableEmptyState
            title="No messages yet"
            description="Send a sandbox SMS to create the first delivery record."
            action={
              <Button asChild>
                <Link href="/send">
                  <Send data-icon="inline-start" />
                  Send SMS
                </Link>
              </Button>
            }
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Message log</CardTitle>
        <CardDescription>
          Filter by recipient, status, provider, or country; select a row for
          its delivery timeline.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <MessagesTable
          messages={result.messages}
          initialMessageId={initialMessageId}
          initialStatus={initialStatus}
        />
      </CardContent>
    </Card>
  );
}

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ messageId?: string; status?: string }>;
}) {
  const params = await searchParams;
  const statuses = [
    "queued",
    "sending",
    "accepted",
    "sent",
    "delivered",
    "undelivered",
    "failed",
    "expired",
  ] as const;
  const initialStatus = statuses.find((status) => status === params.status);
  let result:
    | { kind: "error"; message: string; requestId?: string }
    | { kind: "messages"; messages: readonly MessageSummary[] };
  try {
    result = { kind: "messages", messages: (await getMessageList()).messages };
  } catch (payload) {
    const err = parseApiError(payload);
    result = {
      kind: "error",
      message: err.message,
      ...(err.requestId ? { requestId: err.requestId } : {}),
    };
  }

  return (
    <Shell>
      <PageHeader />
      <Tabs defaultValue="log" className="gap-6">
        <TabsList>
          <TabsTrigger value="log">Log</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
        </TabsList>
        <TabsContent value="log">
          <MessageLog
            result={result}
            initialMessageId={params.messageId}
            initialStatus={initialStatus}
          />
        </TabsContent>
        <TabsContent value="insights">
          <InsightsOverview />
        </TabsContent>
      </Tabs>
    </Shell>
  );
}
