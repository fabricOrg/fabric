"use client";

import { Alert, AlertDescription } from "@app/ui/components/ui/alert";
import { Badge } from "@app/ui/components/ui/badge";
import { ChevronRight, Loader2 } from "lucide-react";
import { useState } from "react";

interface PickerWorkspace {
  readonly tenantId: string;
  readonly name: string;
  readonly role: string;
  readonly plan: string;
}

/**
 * Workspace picker rows: click → POST /api/workspace/switch (server validates membership and sets
 * the selector cookie) → hard navigation into the app so the new cookie takes effect.
 */
export function WorkspacePickerList({
  workspaces,
}: {
  workspaces: readonly PickerWorkspace[];
}) {
  const [pendingTenantId, setPendingTenantId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function enterWorkspace(tenantId: string) {
    if (pendingTenantId) return;
    setPendingTenantId(tenantId);
    setError(null);
    try {
      const response = await fetch("/api/workspace/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      if (!response.ok) {
        setError("We couldn't open that workspace. Please try again.");
        setPendingTenantId(null);
        return;
      }
      window.location.assign("/");
    } catch {
      setError("Something went wrong. Check your connection and try again.");
      setPendingTenantId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <ul className="flex flex-col gap-2">
        {workspaces.map((workspace) => (
          <li key={workspace.tenantId}>
            <button
              type="button"
              onClick={() => enterWorkspace(workspace.tenantId)}
              disabled={pendingTenantId !== null}
              className="flex w-full items-center gap-3 rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-accent disabled:opacity-60"
            >
              <div
                className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-sm font-semibold text-primary"
                aria-hidden="true"
              >
                {workspace.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{workspace.name}</p>
                <p className="text-xs capitalize text-muted-foreground">
                  {workspace.role}
                </p>
              </div>
              {workspace.plan === "sandbox" ? (
                <Badge variant="secondary" className="text-[10px] uppercase">
                  Sandbox
                </Badge>
              ) : null}
              {pendingTenantId === workspace.tenantId ? (
                <Loader2
                  className="size-4 shrink-0 animate-spin text-muted-foreground"
                  aria-hidden="true"
                />
              ) : (
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
