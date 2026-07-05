"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@app/ui/components/ui/alert";
import { Button } from "@app/ui/components/ui/button";
import { Card, CardContent, CardHeader } from "@app/ui/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@app/ui/components/ui/empty";
import { Skeleton } from "@app/ui/components/ui/skeleton";
import {
  BadgeCheck,
  Megaphone,
  Send,
  Signal,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RecentActivity } from "@/components/overview/recent-activity";
import { SpendByChannel } from "@/components/overview/spend-by-channel";
import { StatTiles } from "@/components/overview/stat-tiles";
import { getOverview, type OverviewSummary } from "@/lib/client/overview-api";
import { toastApiError } from "@/lib/error-toast";

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; summary: OverviewSummary };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">{children}</div>
  );
}

function Header() {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Welcome to Fabric
        </h1>
        <p className="text-sm text-muted-foreground">
          Traffic, delivery, and spend across your workspace at a glance.
        </p>
      </div>
      <QuickActions />
    </div>
  );
}

/** Link-only quick actions — the primary jobs launched from home. */
function QuickActions() {
  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild size="sm">
        <Link href="/send">
          <Send data-icon="inline-start" />
          Send
        </Link>
      </Button>
      <Button asChild size="sm" variant="outline">
        <Link href="/campaigns">
          <Megaphone data-icon="inline-start" />
          New campaign
        </Link>
      </Button>
      <Button asChild size="sm" variant="outline">
        <Link href="/verify">
          <BadgeCheck data-icon="inline-start" />
          Verify
        </Link>
      </Button>
    </div>
  );
}

function LoadingState() {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader className="gap-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-4 w-28" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i}>
            <CardHeader className="gap-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-56" />
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {[0, 1, 2, 3].map((r) => (
                <Skeleton key={r} className="h-8 w-full" />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

function isEmpty(summary: OverviewSummary): boolean {
  return summary.messagesSent === 0 && summary.recentActivity.length === 0;
}

export default function OverviewPage() {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "ready", summary: await getOverview() });
    } catch (payload) {
      toastApiError(payload);
      setState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Shell>
      <Header />

      {state.status === "loading" && <LoadingState />}

      {state.status === "error" && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Couldn&apos;t load your overview</AlertTitle>
          <AlertDescription>
            <p>Something went wrong fetching your summary.</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => void load()}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {state.status === "ready" && isEmpty(state.summary) && (
        <Empty className="mx-auto max-w-2xl">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Signal />
            </EmptyMedia>
            <EmptyTitle>Nothing to show yet</EmptyTitle>
            <EmptyDescription>
              Send your first message to start seeing traffic, delivery, and
              spend here.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link href="/send">
                <Send data-icon="inline-start" />
                Send a message
              </Link>
            </Button>
          </EmptyContent>
        </Empty>
      )}

      {state.status === "ready" && !isEmpty(state.summary) && (
        <>
          <StatTiles summary={state.summary} />
          <div className="grid gap-4 lg:grid-cols-2">
            <SpendByChannel channels={state.summary.spendByChannel} />
            <RecentActivity items={state.summary.recentActivity} />
          </div>
        </>
      )}
    </Shell>
  );
}
