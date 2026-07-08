"use client";

import { parseApiError } from "@app/contracts";
import { Button } from "@app/ui/components/ui/button";
import { Card, CardContent, CardHeader } from "@app/ui/components/ui/card";
import { Skeleton } from "@app/ui/components/ui/skeleton";
import { EmptyState, ErrorState } from "@app/ui/components/ui/states";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { BadgeCheck, Megaphone, Send, Signal } from "lucide-react";
import Link from "next/link";
import { RecentActivity } from "@/components/overview/recent-activity";
import { SpendByChannel } from "@/components/overview/spend-by-channel";
import { StatTiles } from "@/components/overview/stat-tiles";
import { TrafficChart } from "@/components/overview/traffic-chart";
import { getOverview, type OverviewSummary } from "@/lib/client/overview-api";

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

/** Body renders exactly one of the first-class states, resolved with early-return if-blocks. */
function OverviewBody({ query }: { query: UseQueryResult<OverviewSummary> }) {
  if (query.isPending) {
    return <LoadingState />;
  }

  if (query.isError) {
    const err = parseApiError(query.error);
    return (
      <ErrorState
        title="Couldn't load your overview"
        message={err.message}
        requestId={err.requestId}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  const summary = query.data;
  if (isEmpty(summary)) {
    return (
      <EmptyState
        icon={<Signal />}
        title="Nothing to show yet"
        description="Send your first message to start seeing traffic, delivery, and spend here."
        action={
          <Button asChild>
            <Link href="/send">
              <Send data-icon="inline-start" />
              Send a message
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <>
      <StatTiles summary={summary} />
      <TrafficChart points={summary.traffic} />
      <div className="grid gap-4 lg:grid-cols-2">
        <SpendByChannel channels={summary.spendByChannel} />
        <RecentActivity items={summary.recentActivity} />
      </div>
    </>
  );
}

export default function OverviewPage() {
  const query = useQuery({ queryKey: ["overview"], queryFn: getOverview });

  return (
    <Shell>
      <Header />
      <OverviewBody query={query} />
    </Shell>
  );
}
