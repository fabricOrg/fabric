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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@app/ui/components/ui/tabs";
import { List, TriangleAlert } from "lucide-react";
import { InsightsOverview } from "@/components/insights/insights-overview";
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
        Every send, its delivery status, and the analytics behind them.
      </p>
    </div>
  );
}

/** The Log tab body — the real-BFF message log, with its error/empty/loaded states intact. */
function MessageLog({
  result,
}: {
  result:
    | { kind: "error"; message: string; requestId?: string }
    | { kind: "messages"; messages: readonly MessageSummary[] };
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
        </AlertDescription>
      </Alert>
    );
  }

  if (result.messages.length === 0) {
    return (
      <Empty className="mx-auto max-w-2xl">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <List />
          </EmptyMedia>
          <EmptyTitle>No messages yet</EmptyTitle>
          <EmptyDescription>
            Your sends will appear here with live delivery status. Head to Send
            SMS to get started.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
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
        <MessagesTable messages={result.messages} />
      </CardContent>
    </Card>
  );
}

export default async function MessagesPage() {
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
          <MessageLog result={result} />
        </TabsContent>
        <TabsContent value="insights">
          <InsightsOverview />
        </TabsContent>
      </Tabs>
    </Shell>
  );
}
