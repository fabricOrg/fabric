"use client";

import type { ApiKey } from "@app/contracts";
import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@app/ui/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@app/ui/components/ui/empty";
import { Skeleton } from "@app/ui/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@app/ui/components/ui/table";
import { KeyRound, TriangleAlert } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { CreateKeyDialog } from "@/components/create-key-dialog";
import { toastApiError } from "@/lib/error-toast";
import { listApiKeys, revokeApiKey, type Scenario } from "@/lib/mock-api";
import { formatTimestamp } from "@/lib/time";

function EnvBadge({ env }: { env: ApiKey["env"] }) {
  return env === "live" ? (
    <Badge variant="destructive">LIVE</Badge>
  ) : (
    <Badge variant="secondary">TEST</Badge>
  );
}

function KeysInner() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorReqId, setErrorReqId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [revoking, setRevoking] = useState(false);

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

  async function confirmRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await revokeApiKey(revokeTarget.id);
      setKeys((prev) =>
        (prev ?? []).map((k) =>
          k.id === revokeTarget.id ? { ...k, status: "revoked" } : k,
        ),
      );
      setRevokeTarget(null);
    } catch (envelope) {
      toastApiError(envelope);
    } finally {
      setRevoking(false);
    }
  }

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
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Env</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{k.name}</TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {k.prefix}
                  </TableCell>
                  <TableCell>
                    <EnvBadge env={k.env} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {k.scopes.map((s) => (
                        <Badge
                          key={s}
                          variant="outline"
                          className="font-mono text-xs"
                        >
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {formatTimestamp(k.lastUsedAt)}
                  </TableCell>
                  <TableCell>
                    {k.status === "active" ? (
                      <Badge className="bg-success/12 text-success border-transparent">
                        Active
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-muted-foreground"
                      >
                        Revoked
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {k.status === "active" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => setRevokeTarget(k)}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(o) => !o && setRevokeTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke “{revokeTarget?.name}”?</DialogTitle>
            <DialogDescription>
              This immediately stops all requests using this key. It can't be
              undone — you'd create a new key to restore access.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmRevoke}
              disabled={revoking}
            >
              {revoking ? "Revoking…" : "Revoke key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
