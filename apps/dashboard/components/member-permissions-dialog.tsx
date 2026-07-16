"use client";

import { membershipPermissions } from "@app/contracts";
import { Button } from "@app/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@app/ui/components/ui/dialog";
import { ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

interface ErrorPayload {
  error?: { message?: string };
}

/**
 * Per-user permission editor (dashboard team page). An owner/admin sets a member's EXACT effective
 * permission set (full override — role becomes a template). Pre-checked from the member's current
 * effective permissions; the api protects the owner and re-validates the set.
 */
export function MemberPermissionsDialog({
  userId,
  label,
  permissions,
}: {
  userId: string;
  label: string;
  permissions: readonly string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(permissions),
  );
  const [saving, setSaving] = useState(false);

  function toggle(permission: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const response = await fetch(`/api/team/members/${userId}/permissions`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          permissions: membershipPermissions.filter((p) => selected.has(p)),
        }),
      });
      if (!response.ok) {
        const payload = (await response
          .json()
          .catch(() => null)) as ErrorPayload | null;
        throw new Error(
          payload?.error?.message ?? "Couldn't save permissions.",
        );
      }
      toast.success(`Updated permissions for ${label}`);
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Couldn't save permissions.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Reset to the current set whenever the dialog opens, so a cancelled edit doesn't stick.
        if (next) setSelected(new Set(permissions));
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ShieldCheck className="size-4" />
          Permissions
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Permissions · {label}</DialogTitle>
          <DialogDescription>
            Choose exactly what this member can do. This overrides their role
            defaults.
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-80 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
          {membershipPermissions.map((permission) => (
            <label
              key={permission}
              className="flex items-center gap-2 rounded-md p-2 text-sm hover:bg-accent/50"
            >
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={selected.has(permission)}
                onChange={() => toggle(permission)}
              />
              <span className="font-mono text-xs">{permission}</span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save permissions"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
