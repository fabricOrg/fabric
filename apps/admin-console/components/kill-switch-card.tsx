"use client";

import type { KillSwitchDto } from "@app/contracts";
import { Badge } from "@app/ui/components/ui/badge";
import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import { Power } from "lucide-react";

function StateBadge({ enabled }: { enabled: boolean }) {
  return (
    <Badge
      variant="outline"
      className={
        enabled
          ? "border-transparent bg-success/12 text-success"
          : "border-transparent bg-destructive/12 text-destructive"
      }
    >
      {enabled ? "Operational" : "Paused"}
    </Badge>
  );
}

/**
 * One capability: the PLATFORM breaker, then the workspaces held separately from it.
 *
 * The two scopes are drawn as one card rather than as a flat list because they are not peers —
 * precedence is platform OR tenant, so a workspace shown as "Operational" under a paused platform
 * breaker is still sending nothing. That case is labelled rather than left for the reader to infer.
 */
export function KillSwitchCard({
  platform,
  overrides,
  canManage,
  canScopeToWorkspace,
  onToggle,
  onAddOverride,
}: {
  platform: KillSwitchDto;
  overrides: readonly KillSwitchDto[];
  canManage: boolean;
  /** False when the workspace list failed to load — there would be nothing to pick from. */
  canScopeToWorkspace: boolean;
  onToggle: (target: KillSwitchDto) => void;
  onAddOverride: (platform: KillSwitchDto) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Power
            className={`size-4 ${platform.enabled ? "text-success" : "text-muted-foreground"}`}
          />
          {platform.label}
          <Badge variant="outline" className="ml-1 text-[10px] uppercase">
            {platform.scope}
          </Badge>
        </CardTitle>
        <CardDescription>{platform.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <StateBadge enabled={platform.enabled} />
            <span className="text-xs text-muted-foreground">
              Every workspace
            </span>
          </div>
          {canManage ? (
            <Button
              size="sm"
              variant={platform.enabled ? "destructive" : "default"}
              onClick={() => onToggle(platform)}
            >
              {platform.enabled ? "Pause" : "Resume"}
            </Button>
          ) : null}
        </div>

        {overrides.length > 0 ? (
          <div className="flex flex-col gap-2 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">
              Workspace overrides
            </p>
            {overrides.map((override) => (
              <div
                key={override.tenant_id}
                className="flex items-center justify-between gap-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <StateBadge enabled={override.enabled} />
                  <span className="truncate text-sm">
                    {override.tenant_name ?? "Unknown workspace"}
                  </span>
                  {override.overridden_by_platform ? (
                    <span className="text-xs text-muted-foreground">
                      — still paused by the platform switch
                    </span>
                  ) : null}
                </div>
                {canManage ? (
                  <Button
                    size="sm"
                    variant={override.enabled ? "destructive" : "outline"}
                    onClick={() => onToggle(override)}
                  >
                    {override.enabled ? "Pause" : "Resume"}
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {/* Not offered where an override would be inert — see `tenant_scopable` — nor when the
            workspace list is unavailable, which would be a live-looking button leading to a dialog
            that can do nothing. */}
        {canManage && platform.tenant_scopable ? (
          canScopeToWorkspace ? (
            <Button
              size="sm"
              variant="ghost"
              className="self-start px-0 text-xs"
              onClick={() => onAddOverride(platform)}
            >
              Pause a single workspace
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              Per-workspace pausing is unavailable — the workspace list
              didn&apos;t load.
            </p>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
