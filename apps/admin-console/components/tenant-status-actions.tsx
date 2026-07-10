"use client";

import type { TenantSummaryDto } from "@app/contracts";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@app/ui/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@app/ui/components/ui/field";
import { Textarea } from "@app/ui/components/ui/textarea";
import { MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

type Status = TenantSummaryDto["status"];

interface ErrorPayload {
  error?: { message?: string };
}

/** A pending status action awaiting its reason (the dialog is shared across the three actions). */
interface PendingAction {
  status: Status;
  title: string;
  blurb: string;
  destructive: boolean;
}

/**
 * Tenant lifecycle control (A4) — suspend / reinstate / soft-close, staff:write only. Every action
 * needs a reason (audited before→after). `closed` is terminal, so a closed account shows no
 * actions. Direct + audited (not maker-checker: decide() doesn't execute — see the service).
 */
export function TenantStatusActions({
  tenantId,
  name,
  status,
}: {
  tenantId: string;
  name: string;
  status: Status;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (status === "closed") {
    return (
      <span className="text-xs text-muted-foreground">Closed (terminal)</span>
    );
  }

  async function submit() {
    if (!pending) return;
    if (reason.trim().length < 8) {
      toast.error("Give a reason (at least 8 characters).");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/tenants/${tenantId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: pending.status, reason: reason.trim() }),
      });
      if (!response.ok) {
        const payload = (await response
          .json()
          .catch(() => null)) as ErrorPayload | null;
        throw new Error(payload?.error?.message ?? "Action failed.");
      }
      toast.success(
        `${name} ${pending.status === "closed" ? "closed" : pending.status}`,
      );
      setPending(null);
      setReason("");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={busy}>
            <MoreHorizontal className="size-4" />
            Manage status
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {status === "active" ? (
            <DropdownMenuItem
              onClick={() =>
                setPending({
                  status: "suspended",
                  title: `Suspend ${name}?`,
                  blurb:
                    "The tenant keeps its data but its access is paused until reinstated.",
                  destructive: false,
                })
              }
            >
              Suspend
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onClick={() =>
                setPending({
                  status: "active",
                  title: `Reinstate ${name}?`,
                  blurb: "Restores the tenant's access.",
                  destructive: false,
                })
              }
            >
              Reinstate
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() =>
              setPending({
                status: "closed",
                title: `Close ${name}?`,
                blurb:
                  "Soft-close is terminal — the account can't be reopened here. Data is retained, not deleted.",
                destructive: true,
              })
            }
          >
            Close account
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null);
            setReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending?.title}</DialogTitle>
            <DialogDescription>{pending?.blurb}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="tenant-status-reason">Reason</FieldLabel>
            <Textarea
              id="tenant-status-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Recorded in the audit log (min 8 characters)."
              rows={3}
            />
          </Field>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPending(null);
                setReason("");
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant={pending?.destructive ? "destructive" : "default"}
              onClick={submit}
              loading={busy}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
