"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@app/ui/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@app/ui/components/ui/sidebar";
import { Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export interface SwitcherWorkspace {
  readonly tenantId: string;
  readonly name: string;
  readonly role: string;
}

/**
 * ADR-0007 in-app workspace switcher (Stripe's account picker). Switching only rewrites the
 * selector cookie server-side — authentication is untouched — then hard-navigates so every
 * server component re-renders under the new tenant.
 */
export function WorkspaceSwitcher({
  activeTenantId,
  workspaces,
}: {
  activeTenantId: string;
  workspaces: readonly SwitcherWorkspace[];
}) {
  const [switching, setSwitching] = useState(false);
  const active = workspaces.find(
    (workspace) => workspace.tenantId === activeTenantId,
  );

  async function switchWorkspace(tenantId: string) {
    if (switching || tenantId === activeTenantId) return;
    setSwitching(true);
    try {
      const response = await fetch("/api/workspace/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      if (response.ok) {
        window.location.assign("/");
        return;
      }
    } catch {
      // fall through to re-enable the trigger; the picker page is the recovery path
    }
    setSwitching(false);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
          className="h-10"
          tooltip={active ? active.name : "Workspace"}
        >
          <div
            className="flex size-5 shrink-0 items-center justify-center rounded bg-primary/10 text-[10px] font-semibold text-primary"
            aria-hidden="true"
          >
            {(active?.name ?? "?").slice(0, 1).toUpperCase()}
          </div>
          <span className="truncate text-sm font-medium">
            {active?.name ?? "Select workspace"}
          </span>
          {switching ? (
            <Loader2 className="ml-auto size-4 shrink-0 animate-spin" />
          ) : (
            <ChevronsUpDown className="ml-auto size-4 shrink-0 text-muted-foreground" />
          )}
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Workspaces
        </DropdownMenuLabel>
        {workspaces.map((workspace) => (
          <DropdownMenuItem
            key={workspace.tenantId}
            onSelect={() => switchWorkspace(workspace.tenantId)}
            disabled={switching}
            className="gap-2"
          >
            <span className="truncate">{workspace.name}</span>
            <span className="ml-auto text-xs capitalize text-muted-foreground">
              {workspace.role}
            </span>
            {workspace.tenantId === activeTenantId ? (
              <Check className="size-4 shrink-0" />
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding" className="gap-2">
            <Plus className="size-4" />
            Create workspace
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
