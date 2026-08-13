"use client";

import { parseApiError } from "@app/contracts";
import { PageContainer } from "@app/ui/components/ui/app-shell";
import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import { Skeleton } from "@app/ui/components/ui/skeleton";
import { ErrorState } from "@app/ui/components/ui/states";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  BadgeCheck,
  KeyRound,
  Megaphone,
  Send,
  Signal,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ActivationChecklist } from "@/components/overview/activation-checklist";
import { AttentionQueue } from "@/components/overview/attention-queue";
import { RecentActivity } from "@/components/overview/recent-activity";
import { SpendByChannel } from "@/components/overview/spend-by-channel";
import { StatTiles } from "@/components/overview/stat-tiles";
import { TrafficChart } from "@/components/overview/traffic-chart";
import { getOverview, type OverviewSummary } from "@/lib/client/overview-api";
import { listSenders, type SenderId } from "@/lib/client/senders-api";

function Header() {
  return (
    <PageHeader>
      <PageHeaderHeading>
        <PageHeaderTitle>Welcome to Fabric</PageHeaderTitle>
        <PageHeaderDescription>
          Traffic, delivery, and spend across your workspace at a glance.
        </PageHeaderDescription>
      </PageHeaderHeading>
      <PageHeaderActions>
        <QuickActions />
      </PageHeaderActions>
    </PageHeader>
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
          Verify number
        </Link>
      </Button>
    </div>
  );
}

function FirstRunPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Signal className="size-4 text-primary" />
          Launch your first delivery
        </CardTitle>
        <CardAction>
          <Button asChild size="sm">
            <Link href="/send">
              Send SMS
              <ArrowUpRight data-icon="inline-end" />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        <FirstRunStep
          icon={<KeyRound />}
          title="Prepare identity"
          href="/senders"
        />
        <FirstRunStep icon={<Wallet />} title="Add balance" href="/wallet" />
        <FirstRunStep
          icon={<Signal />}
          title="Inspect delivery"
          href="/messages"
        />
      </CardContent>
    </Card>
  );
}

function FirstRunStep({
  icon,
  title,
  href,
}: {
  icon: ReactNode;
  title: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex min-w-0 flex-col gap-3 rounded-md border bg-muted/20 p-4 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    >
      <span className="flex size-8 items-center justify-center border bg-background text-primary [&_svg]:size-4">
        {icon}
      </span>
      <span className="flex flex-col gap-1">
        <span className="font-medium text-sm group-hover:text-accent-foreground">
          {title}
        </span>
      </span>
    </Link>
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
function OverviewBody({
  query,
  senders,
}: {
  query: UseQueryResult<OverviewSummary>;
  senders?: readonly SenderId[];
}) {
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
      <>
        <ActivationChecklist summary={summary} senders={senders} />
        <FirstRunPanel />
      </>
    );
  }

  return (
    <>
      <ActivationChecklist summary={summary} senders={senders} />
      <AttentionQueue summary={summary} senders={senders} />
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
  const sendersQuery = useQuery({
    queryKey: ["senders"],
    queryFn: listSenders,
  });

  return (
    <PageContainer>
      <Header />
      <OverviewBody query={query} senders={sendersQuery.data} />
    </PageContainer>
  );
}
