"use client";

import type { ApiKey, ApiKeyEnv } from "@app/contracts";
import { Button } from "@app/ui/components/ui/button";
import {
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
} from "@app/ui/components/ui/card";
import { cn } from "@app/ui/lib/utils";
import { useState } from "react";
import { CreateApiKeyDialog } from "@/components/forms/create-api-key-dialog";
import { ApiKeysTable } from "@/components/tables/api-keys-table";

/**
 * API keys tab body. Keys come in TEST and LIVE flavours and a developer manages both, so once the
 * workspace has gone live this exposes a Test / Live switch to view + create each set. Before go-live
 * only test keys exist, so the switch is hidden and the tab is test-only. Independent of the topbar
 * delivery toggle (which drives webhooks/logs) — you may hold live keys while still delivering to the
 * virtual phone.
 */
export function ApiKeysPanel({
  keys,
  applicationId,
  liveActive,
  defaultEnv,
  canManage,
}: {
  keys: readonly ApiKey[];
  applicationId: string;
  liveActive: boolean;
  defaultEnv: ApiKeyEnv;
  canManage: boolean;
}) {
  const [keyEnv, setKeyEnv] = useState<ApiKeyEnv>(defaultEnv);
  // Pre-go-live there are no live keys — never leave the switch on a set that can't exist.
  const activeEnv: ApiKeyEnv = liveActive ? keyEnv : "test";
  const shown = keys.filter((k) => k.env === activeEnv);

  return (
    <>
      <CardHeader>
        <CardDescription>
          {activeEnv === "live"
            ? "Live keys spend real money and deliver to carriers."
            : "Test keys are sandboxed — they never charge or send."}
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          {liveActive ? (
            <div
              className="inline-flex rounded-md border p-0.5"
              role="group"
              aria-label="Key environment"
            >
              {(["test", "live"] as const).map((e) => (
                <Button
                  key={e}
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-pressed={activeEnv === e}
                  onClick={() => setKeyEnv(e)}
                  className={cn(
                    "h-7 px-3 text-xs",
                    activeEnv === e && "bg-muted text-foreground",
                  )}
                >
                  {e === "live" ? "Live" : "Test"}
                </Button>
              ))}
            </div>
          ) : null}
          {canManage ? (
            <CreateApiKeyDialog applicationId={applicationId} env={activeEnv} />
          ) : null}
        </CardAction>
      </CardHeader>
      <CardContent>
        <ApiKeysTable keys={shown} />
      </CardContent>
    </>
  );
}
