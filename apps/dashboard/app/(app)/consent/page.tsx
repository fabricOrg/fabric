"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@app/ui/components/ui/alert";
import { PageContainer } from "@app/ui/components/ui/app-shell";
import { Card, CardContent, CardHeader } from "@app/ui/components/ui/card";
import {
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
  PageHeader as UIPageHeader,
} from "@app/ui/components/ui/page-header";
import { Skeleton } from "@app/ui/components/ui/skeleton";
import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { ClassificationCard } from "@/components/consent/classification-card";
import { QuietHoursCard } from "@/components/consent/quiet-hours-card";
import { OptOutTable } from "@/components/tables/opt-out-table";
import {
  type ConsentSnapshot,
  getConsent,
  type OptOut,
  type QuietHours,
} from "@/lib/client/consent-api";
import { toastApiError } from "@/lib/error-toast";

type LoadState = "loading" | "ready" | "error";

function PageHeader() {
  return (
    <UIPageHeader>
      <PageHeaderHeading>
        <PageHeaderTitle>Consent &amp; DND</PageHeaderTitle>
        <PageHeaderDescription className="max-w-3xl">
          Opting out is a legal right. Transactional messages — OTP, alerts,
          receipts — always deliver. Promotional SMS respects opt-outs and only
          sends inside your quiet-hours window.
        </PageHeaderDescription>
      </PageHeaderHeading>
    </UIPageHeader>
  );
}

function LoadingSkeleton() {
  return (
    <>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full max-w-md" />
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-full max-w-md" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24" />
        </CardContent>
      </Card>
    </>
  );
}

export default function ConsentPage() {
  const [snapshot, setSnapshot] = useState<ConsentSnapshot | null>(null);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    let live = true;
    getConsent()
      .then((data) => {
        if (!live) return;
        setSnapshot(data);
        setState("ready");
      })
      .catch((payload) => {
        if (!live) return;
        setState("error");
        toastApiError(payload);
      });
    return () => {
      live = false;
    };
  }, []);

  function handleQuietHoursSaved(next: QuietHours) {
    setSnapshot((prev) => (prev ? { ...prev, quietHours: next } : prev));
  }

  function handleOptOutAdded(optOut: OptOut) {
    setSnapshot((prev) =>
      prev ? { ...prev, optOuts: [optOut, ...prev.optOuts] } : prev,
    );
  }

  function handleOptOutRemoved(id: string) {
    setSnapshot((prev) =>
      prev
        ? { ...prev, optOuts: prev.optOuts.filter((o) => o.id !== id) }
        : prev,
    );
  }

  return (
    <PageContainer>
      <PageHeader />

      {state === "loading" && <LoadingSkeleton />}

      {state === "error" && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Couldn&apos;t load consent settings</AlertTitle>
          <AlertDescription>
            Something went wrong fetching your opt-out list and rules. Retry in
            a moment — if it persists, contact support.
          </AlertDescription>
        </Alert>
      )}

      {state === "ready" && snapshot && (
        <>
          <ClassificationCard rules={snapshot.rules} />
          <QuietHoursCard
            quietHours={snapshot.quietHours}
            onSaved={handleQuietHoursSaved}
          />
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-1">
                <h2 className="font-display text-lg font-semibold tracking-tight">
                  Opt-out list
                </h2>
                <p className="text-sm text-muted-foreground">
                  Numbers excluded from promotional sends. Search by number, or
                  filter by scope and how the opt-out was captured.
                </p>
              </div>
            </CardHeader>
            <CardContent>
              <OptOutTable
                optOuts={snapshot.optOuts}
                onAdd={handleOptOutAdded}
                onRemove={handleOptOutRemoved}
              />
            </CardContent>
          </Card>
        </>
      )}
    </PageContainer>
  );
}
