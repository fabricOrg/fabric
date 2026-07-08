"use client";

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
import { Skeleton } from "@app/ui/components/ui/skeleton";
import { TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { VerificationLog } from "@/components/tables/verification-log";
import { ChannelConfigCard } from "@/components/verify/channel-config-card";
import { ConversionStats } from "@/components/verify/conversion-stats";
import { TestVerificationCard } from "@/components/verify/test-verification-card";
import { VerifyTrend } from "@/components/verify/verify-trend";
import {
  getVerifyOverview,
  type Verification,
  type VerifyChannel,
  type VerifyOverview,
} from "@/lib/client/verify-api";
import { toastApiError } from "@/lib/error-toast";

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">{children}</div>
  );
}

function PageHeader() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="font-display text-2xl font-semibold tracking-tight">
        Verify
      </h1>
      <p className="text-sm text-muted-foreground">
        One API to confirm a user across SMS, voice, WhatsApp, and email — with
        automatic failover between channels.
      </p>
    </div>
  );
}

export default function VerifyPage() {
  const [data, setData] = useState<VerifyOverview | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    getVerifyOverview()
      .then((overview) => {
        if (live) setData(overview);
      })
      .catch((payload) => {
        if (!live) return;
        setError(true);
        toastApiError(payload);
      });
    return () => {
      live = false;
    };
  }, []);

  function handleChannelsSaved(channels: VerifyChannel[]) {
    setData((prev) => (prev ? { ...prev, channels } : prev));
  }

  // A live test attempt lands at the top of the log and moves the funnel (sent+delivered on start).
  function handleStarted(v: Verification) {
    setData((prev) =>
      prev
        ? {
            ...prev,
            recent: [v, ...prev.recent].slice(0, 25),
            stats: {
              ...prev.stats,
              sent: prev.stats.sent + 1,
              delivered: prev.stats.delivered + 1,
            },
          }
        : prev,
    );
  }

  // Resolution updates the same row in place; a success ticks the verified counter.
  function handleResolved(v: Verification) {
    setData((prev) =>
      prev
        ? {
            ...prev,
            recent: prev.recent.map((r) => (r.id === v.id ? v : r)),
            stats:
              v.status === "verified"
                ? { ...prev.stats, verified: prev.stats.verified + 1 }
                : prev.stats,
          }
        : prev,
    );
  }

  if (error && !data) {
    return (
      <Shell>
        <PageHeader />
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Couldn&apos;t load Verify</AlertTitle>
          <AlertDescription>
            We couldn&apos;t reach the Verify service. Retry in a moment — if it
            persists, contact support.
          </AlertDescription>
        </Alert>
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell>
        <PageHeader />
        <Skeleton className="h-40 w-full rounded-xl" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-80 w-full rounded-xl" />
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </Shell>
    );
  }

  return (
    <Shell>
      <PageHeader />

      <ConversionStats stats={data.stats} />

      {data.trend.length > 0 ? <VerifyTrend points={data.trend} /> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <ChannelConfigCard
          channels={data.channels}
          onSaved={handleChannelsSaved}
        />
        <TestVerificationCard
          channels={data.channels}
          onStarted={handleStarted}
          onResolved={handleResolved}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent verifications</CardTitle>
          <CardDescription>
            Live attempts across every channel. OTP bodies are redacted by
            default.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VerificationLog verifications={data.recent} />
        </CardContent>
      </Card>
    </Shell>
  );
}
