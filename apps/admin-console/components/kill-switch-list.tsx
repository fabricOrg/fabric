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
import { Power } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

interface ErrorPayload {
  error?: { message?: string };
}

export function KillSwitchList({
  switches,
  canManage,
}: {
  switches: readonly KillSwitchDto[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<KillSwitchDto | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = reason.trim().length >= 8;
  // Toggling flips to the opposite of the current state.
  const willPause = pending?.enabled === true;

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/admin/kill-switches/${encodeURIComponent(pending.key)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            enabled: !pending.enabled,
            reason: reason.trim(),
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
      toast.success(
        `${pending.label} ${willPause ? "PAUSED" : "resumed"} (reason logged)`,
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
        {switches.map((k) => (
          <Card key={k.key}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Power
                  className={`size-4 ${k.enabled ? "text-success" : "text-muted-foreground"}`}
                />
                {k.label}
                <Badge variant="outline" className="ml-1 text-[10px] uppercase">
                  {k.scope}
                </Badge>
              </CardTitle>
              <CardDescription>{k.description}</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between gap-2">
              <Badge
                variant="outline"
                className={
                  k.enabled
                    ? "border-transparent bg-success/12 text-success"
                    : "border-transparent bg-destructive/12 text-destructive"
                }
              >
                {k.enabled ? "Operational" : "Paused"}
              </Badge>
              {canManage ? (
                <Button
                  size="sm"
                  variant={k.enabled ? "destructive" : "default"}
                  onClick={() => {
                    setReason("");
                    setPending(k);
                  }}
                >
                  {k.enabled ? "Pause" : "Resume"}
                </Button>
              ) : null}
            </CardContent>
          </Card>
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
              {willPause ? "Pause" : "Resume"}: {pending?.label}
            </DialogTitle>
            <DialogDescription>
              This affects live traffic. Enter a reason — it goes to the audit
              log.
            </DialogDescription>
          </DialogHeader>
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
