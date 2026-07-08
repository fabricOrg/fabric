"use client";

import type { ApiKey } from "@app/contracts";
import { Button } from "@app/ui/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@app/ui/components/ui/empty";
import { Skeleton } from "@app/ui/components/ui/skeleton";
import { KeyRound, TriangleAlert } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { CreateKeyDialog } from "@/components/forms/create-key-dialog";
import { ApiKeysTable } from "@/components/tables/api-keys-table";
import { toastApiError } from "@/lib/error-toast";
import { listApiKeys, type Scenario } from "@/lib/mock-api";

function KeysInner() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorReqId, setErrorReqId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const stateParam = useSearchParams().get("state");
  const scenario: Scenario =
    stateParam === "empty" || stateParam === "error" ? stateParam : "populated";

  // biome-ignore lint/correctness/useExhaustiveDependencies: `reload` is a manual refetch trigger, not read in the effect
  useEffect(() => {
    let live = true;
    setLoading(true);
    setErrorReqId(null);
    listApiKeys(scenario)
      .then((data) => {
        if (live) setKeys([...data]);
      })
      .catch((envelope) => {
        if (!live) return;
        setErrorReqId(toastApiError(envelope).requestId ?? null);
        setKeys(null);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [reload, scenario]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            API keys
          </h1>
          <p className="text-sm text-muted-foreground">
            Authenticate API requests. Test keys are sandboxed; live keys spend
            real money.
          </p>
        </div>
        <CreateKeyDialog
          onCreated={(key) => setKeys((prev) => [key, ...(prev ?? [])])}
        />
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : errorReqId !== null || keys === null ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TriangleAlert />
            </EmptyMedia>
            <EmptyTitle>Couldn't load keys</EmptyTitle>
            <EmptyDescription>
              Please try again.{" "}
              {errorReqId ? `Contact support with ${errorReqId}.` : ""}
            </EmptyDescription>
          </EmptyHeader>
          <Button variant="outline" onClick={() => setReload((x) => x + 1)}>
            Retry
          </Button>
        </Empty>
      ) : keys.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KeyRound />
            </EmptyMedia>
            <EmptyTitle>No API keys yet</EmptyTitle>
            <EmptyDescription>
              Create your first key to start calling the Fabric API. Begin with
              a test key.
            </EmptyDescription>
          </EmptyHeader>
          <CreateKeyDialog onCreated={(key) => setKeys([key])} />
        </Empty>
      ) : (
        <ApiKeysTable
          keys={keys}
          onRevoked={(id) =>
            setKeys((prev) =>
              (prev ?? []).map((k) =>
                k.id === id ? { ...k, status: "revoked" } : k,
              ),
            )
          }
        />
      )}
    </div>
  );
}

export default function ApiKeysPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-5xl p-6">Loading…</div>}>
      <KeysInner />
    </Suspense>
  );
}
