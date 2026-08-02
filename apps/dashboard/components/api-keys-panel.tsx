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
 * application's live environment is unlocked this exposes a Sandbox / Live switch. Independent of the
 * topbar delivery toggle (which drives webhooks/logs) — you may hold live keys while still delivering
 * to the virtual phone.
 *
 * When live is LOCKED the switch stays visible but disabled, with the reason stated. It used to be
 * hidden and `activeEnv` silently forced to `sandbox`, which produced the worst version of this: the
 * workspace chrome said "Live", the page offered "Create key", and what arrived was an `sk_test_` key
 * with nothing anywhere explaining why. A control that is absent teaches nothing; a control that is
 * present and disabled says both that live keys exist and what has to happen first.
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
          {activeEnv === "live" ? (
            "Live keys spend real money and deliver to carriers."
          ) : liveActive ? (
            "Sandbox keys never charge or reach real recipients."
          ) : (
            <>
              Sandbox keys never charge or reach real recipients. This
              application&apos;s live environment is still locked, so live keys
              can&apos;t be created yet —{" "}
              <Link href="/go-live" className="underline hover:text-foreground">
                request go-live
              </Link>{" "}
              to unlock it.
            </>
          )}
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          <div
            className="inline-flex rounded-md border p-0.5"
            role="group"
            aria-label="Key environment"
          >
            {(["sandbox", "live"] as const).map((e) => {
              const locked = e === "live" && !liveActive;
              return (
                <Button
                  key={e}
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={locked}
                  aria-pressed={activeEnv === e}
                  // `title` rather than a Tooltip: a disabled button never fires the pointer events
                  // Radix's Tooltip trigger listens for, so a Tooltip here would silently never open.
                  title={
                    locked
                      ? "This application's live environment is locked. Go live to create live keys."
                      : undefined
                  }
                  onClick={() => setKeyEnv(e)}
                  className={cn(
                    "h-7 px-3 text-xs",
                    activeEnv === e && "bg-muted text-foreground",
                  )}
                >
                  {e === "live" ? "Live" : "Sandbox"}
                </Button>
              );
            })}
          </div>
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
