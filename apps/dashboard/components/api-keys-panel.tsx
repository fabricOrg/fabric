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
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ApiKeysTable } from "@/components/tables/api-keys-table";

/**
 * API keys tab body. Keys belong to Sandbox or Live and a developer manages both, so once the
 * workspace has gone live this exposes a Sandbox / Live switch. Before go-live only sandbox keys
 * exist, so the switch is hidden and the tab is sandbox-only. Independent of the topbar
 * delivery toggle (which drives webhooks/logs) — you may hold live keys while still delivering to the
 * virtual phone.
 */
export function ApiKeysPanel({
  keys,
  applicationSlug,
  liveActive,
  defaultEnv,
  canManage,
}: {
  keys: readonly ApiKey[];
  applicationSlug: string;
  liveActive: boolean;
  defaultEnv: ApiKeyEnv;
  canManage: boolean;
}) {
  const [keyEnv, setKeyEnv] = useState<ApiKeyEnv>(defaultEnv);
  // Pre-go-live there are no live keys — never leave the switch on a set that can't exist.
  const activeEnv: ApiKeyEnv = liveActive ? keyEnv : "sandbox";
  const shown = keys.filter((k) => k.env === activeEnv);

  return (
    <>
      <CardHeader>
        <CardDescription>
          {activeEnv === "live"
            ? "Live keys spend real money and deliver to carriers."
            : "Sandbox keys never charge or reach real recipients."}
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          {liveActive ? (
            <div
              className="inline-flex rounded-md border p-0.5"
              role="group"
              aria-label="Key environment"
            >
              {(["sandbox", "live"] as const).map((e) => (
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
                  {e === "live" ? "Live" : "Sandbox"}
                </Button>
              ))}
            </div>
          ) : null}
          {canManage ? (
            <Button size="sm" variant="outline" asChild>
              <Link
                href={`/applications/${applicationSlug}/api-keys/new?env=${activeEnv}`}
              >
                <Plus data-icon="inline-start" />
                Create key
              </Link>
            </Button>
          ) : null}
        </CardAction>
      </CardHeader>
      <CardContent>
        <ApiKeysTable keys={shown} />
      </CardContent>
    </>
  );
}
