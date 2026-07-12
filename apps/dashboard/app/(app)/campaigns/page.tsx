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
  PageHeaderActions,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
  PageHeader as UIPageHeader,
} from "@app/ui/components/ui/page-header";
import { Skeleton } from "@app/ui/components/ui/skeleton";
import { TableEmptyState } from "@app/ui/components/ui/states";
import { Plus, RotateCcw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CampaignTable } from "@/components/tables/campaign-table";
import { type Campaign, listCampaigns } from "@/lib/client/campaigns-api";
import { toastApiError } from "@/lib/error-toast";

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="flex w-full flex-col gap-6">{children}</div>;
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

  const load = useCallback(async () => {
    setFailed(null);
    setCampaigns(null);
    try {
      setCampaigns(await listCampaigns());
    } catch (envelope) {
      const err = toastApiError(envelope);
      setFailed({ message: err.message, requestId: err.requestId });
    }
  }, []);

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

  const previewNotice = (
    <Alert>
      <TriangleAlert />
      <AlertTitle>Campaigns is a preview</AlertTitle>
      <AlertDescription>
        Campaign records currently use the dashboard preview service. Do not use
        this workspace as evidence that a production audience was sent.
      </AlertDescription>
    </Alert>
  );

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
        {previewNotice}
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
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RotateCcw data-icon="inline-start" />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </Shell>
    );
  }

  if (campaigns === null) {
    return (
      <Shell>
        <PageHeader action={createAction} />
        {previewNotice}
        <TableSkeleton />
      </Shell>
    );
  }

  if (campaigns.length === 0) {
    return (
      <Shell>
        <PageHeader action={createAction} />
        {previewNotice}
        <Card>
          <CardHeader>
            <CardTitle>All campaigns</CardTitle>
            <CardDescription>
              Draft, schedule, and monitor audience sends.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TableEmptyState
              title="No campaigns yet"
              description="Create a draft, choose an audience and sender, review consent and cost, then schedule delivery."
            />
          </CardContent>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <PageHeader action={createAction} />
      {previewNotice}
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
