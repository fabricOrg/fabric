"use client";

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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@app/ui/components/ui/empty";
import {
  PageHeaderActions,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
  PageHeader as UIPageHeader,
} from "@app/ui/components/ui/page-header";
import { Skeleton } from "@app/ui/components/ui/skeleton";
import { Megaphone, Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CampaignTable } from "@/components/campaigns/campaign-table";
import { type Campaign, listCampaigns } from "@/lib/client/campaigns-api";
import { toastApiError } from "@/lib/error-toast";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">{children}</div>
  );
}

function PageHeader({ action }: { action?: React.ReactNode }) {
  return (
    <UIPageHeader>
      <PageHeaderHeading>
        <PageHeaderTitle>Campaigns</PageHeaderTitle>
        <PageHeaderDescription>
          Bulk messaging to whole audiences — schedule sends, respect opt-outs,
          and track delivery.
        </PageHeaderDescription>
      </PageHeaderHeading>
      {action ? <PageHeaderActions>{action}</PageHeaderActions> : null}
    </UIPageHeader>
  );
}

function TableSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-64" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-9 w-48" />
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [failed, setFailed] = useState<{
    message: string;
    requestId?: string;
  } | null>(null);

  useEffect(() => {
    let live = true;
    listCampaigns()
      .then((list) => {
        if (live) setCampaigns(list);
      })
      .catch((envelope) => {
        if (!live) return;
        const err = toastApiError(envelope);
        setFailed({ message: err.message, requestId: err.requestId });
      });
    return () => {
      live = false;
    };
  }, []);

  const createAction = (
    <Button asChild>
      <Link href="/campaigns/new">
        <Plus data-icon="inline-start" />
        New campaign
      </Link>
    </Button>
  );

  if (failed) {
    return (
      <Shell>
        <PageHeader action={createAction} />
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Couldn&apos;t load your campaigns</AlertTitle>
          <AlertDescription>
            <p>{failed.message}</p>
            {failed.requestId && (
              <p>
                Contact support with{" "}
                <code className="font-mono">{failed.requestId}</code>.
              </p>
            )}
          </AlertDescription>
        </Alert>
      </Shell>
    );
  }

  if (campaigns === null) {
    return (
      <Shell>
        <PageHeader action={createAction} />
        <TableSkeleton />
      </Shell>
    );
  }

  if (campaigns.length === 0) {
    return (
      <Shell>
        <PageHeader />
        <Empty className="mx-auto max-w-2xl">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Megaphone />
            </EmptyMedia>
            <EmptyTitle>No campaigns yet</EmptyTitle>
            <EmptyDescription>
              Reach a whole audience with one message. Create your first
              campaign to schedule a send and track delivery.
            </EmptyDescription>
          </EmptyHeader>
          {createAction}
        </Empty>
      </Shell>
    );
  }

  return (
    <Shell>
      <PageHeader action={createAction} />
      <Card>
        <CardHeader>
          <CardTitle>All campaigns</CardTitle>
          <CardDescription>
            Filter by status; select a campaign for its delivery breakdown.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CampaignTable campaigns={campaigns} />
        </CardContent>
      </Card>
    </Shell>
  );
}
