"use client";

import type { KillSwitchDto } from "@app/contracts";
import { Button } from "@app/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@app/ui/components/ui/dialog";
import { Field, FieldLabel } from "@app/ui/components/ui/field";
import { Input } from "@app/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { KillSwitchCard } from "./kill-switch-card";

interface ErrorPayload {
  error?: { message?: string };
}

export interface WorkspaceOption {
  id: string;
  name: string;
}

/** What the dialog is about to do. `tenantId === undefined` = the operator still has to pick one. */
interface Pending {
  target: KillSwitchDto;
  enabled: boolean;
  tenantId: string | null | undefined;
}

export function KillSwitchList({
  switches,
  workspaces,
  canManage,
}: {
  switches: readonly KillSwitchDto[];
  workspaces: readonly WorkspaceOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  // A switch is (key, tenant) now, so the flat list is grouped: the platform breaker owns the card
  // and the overrides hang off it.
  const groups = useMemo(() => {
    const platforms = switches.filter((s) => s.tenant_id === null);
    return platforms.map((platform) => ({
      platform,
      overrides: switches.filter(
        (s) => s.key === platform.key && s.tenant_id !== null,
      ),
    }));
  }, [switches]);

  const willPause = pending?.enabled === false;
  const needsWorkspace = pending?.tenantId === undefined;
  const valid = reason.trim().length >= 8 && !needsWorkspace;

  function open(next: Pending) {
    setReason("");
    setPending(next);
  }

  async function confirm() {
    if (!pending || pending.tenantId === undefined) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/admin/kill-switches/${encodeURIComponent(pending.target.key)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            enabled: pending.enabled,
            reason: reason.trim(),
            tenant_id: pending.tenantId,
          }),
        },
      );
      if (!response.ok) {
        const payload = (await response
          .json()
          .catch(() => null)) as ErrorPayload | null;
        throw new Error(
          payload?.error?.message ?? "Couldn't update the switch.",
        );
      }
      const scope = pending.tenantId
        ? (workspaces.find((w) => w.id === pending.tenantId)?.name ??
          "that workspace")
        : "every workspace";
      toast.success(
        `${pending.target.label} ${willPause ? "PAUSED" : "resumed"} for ${scope} (reason logged)`,
      );
      setPending(null);
      setReason("");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't update the switch.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* gap-6, not gap-3: a Card's registration marks sit 6px outside its border, so a 12px gap
          makes the bottom marks of one row collide with the top marks of the next. */}
      <div className="flex flex-col gap-6">
        {groups.map(({ platform, overrides }) => (
          <KillSwitchCard
            key={platform.key}
            platform={platform}
            overrides={overrides}
            canManage={canManage}
            onToggle={(target) =>
              open({
                target,
                enabled: !target.enabled,
                tenantId: target.tenant_id,
              })
            }
            onAddOverride={(target) =>
              open({ target, enabled: false, tenantId: undefined })
            }
          />
        ))}
      </div>

      <Dialog
        open={pending !== null}
        onOpenChange={(o) => {
          if (!o) {
            setPending(null);
            setReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {willPause ? "Pause" : "Resume"}: {pending?.target.label}
            </DialogTitle>
            <DialogDescription>
              {pending?.tenantId === null
                ? "This affects live traffic for EVERY workspace. Enter a reason — it goes to the audit log."
                : "This affects live traffic for one workspace. Enter a reason — it goes to the audit log."}
            </DialogDescription>
          </DialogHeader>

          {needsWorkspace && workspaces.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              The workspace list didn&apos;t load, so there is nothing to scope
              this to. Reload the page and try again.
            </p>
          ) : null}

          {needsWorkspace && workspaces.length > 0 ? (
            <Field>
              <FieldLabel htmlFor="ks-workspace">Workspace</FieldLabel>
              <Select
                onValueChange={(value) =>
                  setPending((p) => (p ? { ...p, tenantId: value } : p))
                }
              >
                <SelectTrigger id="ks-workspace">
                  <SelectValue placeholder="Choose a workspace" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((workspace) => (
                    <SelectItem key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          <Field>
            <FieldLabel htmlFor="ks-reason">Reason (min 8 chars)</FieldLabel>
            <Input
              id="ks-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Spam complaint investigation, ticket #4830"
            />
          </Field>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPending(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant={willPause ? "destructive" : "default"}
              disabled={!valid}
              loading={busy}
              onClick={confirm}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
