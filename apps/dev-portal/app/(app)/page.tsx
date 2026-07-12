"use client";

import type { ApiKey } from "@app/contracts";
import { PageContainer } from "@app/ui/components/ui/app-shell";
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import {
  ErrorState,
  TableEmptyState,
  TableLoadingState,
} from "@app/ui/components/ui/states";
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
    <PageContainer>
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitle>API keys</PageHeaderTitle>
          <PageHeaderDescription>
            Authenticate API requests. Test keys are sandboxed; live keys spend
            real money.
          </PageHeaderDescription>
        </PageHeaderHeading>
        <PageHeaderActions>
          <CreateKeyDialog
            onCreated={(key) => setKeys((prev) => [key, ...(prev ?? [])])}
          />
        </PageHeaderActions>
      </PageHeader>

      {loading ? (
        <TableLoadingState rows={4} />
      ) : errorReqId !== null || keys === null ? (
        <ErrorState
          title="Couldn't load keys"
          message={
            errorReqId
              ? `Please try again. Contact support with ${errorReqId}.`
              : "Please try again."
          }
          onRetry={() => setReload((x) => x + 1)}
        />
      ) : keys.length === 0 ? (
        <TableEmptyState
          title="No API keys yet"
          description="Create your first key to start calling the Fabric API. Begin with a test key."
          action={<CreateKeyDialog onCreated={(key) => setKeys([key])} />}
        />
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
    </PageContainer>
  );
}

export default function ApiKeysPage() {
  return (
    <Suspense fallback={<div className="w-full">Loading…</div>}>
      <KeysInner />
    </Suspense>
  );
}
