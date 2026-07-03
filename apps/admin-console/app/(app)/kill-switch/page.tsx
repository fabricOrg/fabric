"use client";

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
import { useState } from "react";
import { toast } from "sonner";
import { KILL_SWITCHES, type KillSwitch } from "@/lib/mock-admin";

export default function KillSwitchPage() {
  const [state, setState] = useState<Record<string, boolean>>(
    Object.fromEntries(KILL_SWITCHES.map((k) => [k.id, k.enabled])),
  );
  const [pending, setPending] = useState<KillSwitch | null>(null);
  const [reason, setReason] = useState("");
  const valid = reason.trim().length >= 8;

  function confirm() {
    if (!pending) return;
    const next = !state[pending.id];
    setState((s) => ({ ...s, [pending.id]: next }));
    // Mock — TODO(BFF): step-up auth before this; the toggle + reason writes to the audit log.
    toast.success(
      `${pending.label} ${next ? "enabled" : "PAUSED"} (reason logged)`,
    );
    setPending(null);
    setReason("");
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Kill-switch
        </h1>
        <p className="text-sm text-muted-foreground">
          Operational switches over live traffic. Every change needs a reason
          and is audited.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {KILL_SWITCHES.map((k) => {
          const on = state[k.id];
          return (
            <Card key={k.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Power
                    className={`size-4 ${on ? "text-success" : "text-muted-foreground"}`}
                  />
                  {k.label}
                  <Badge
                    variant="outline"
                    className="ml-1 text-[10px] uppercase"
                  >
                    {k.scope}
                  </Badge>
                </CardTitle>
                <CardDescription>{k.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-2">
                <Badge
                  variant="outline"
                  className={
                    on
                      ? "border-transparent bg-success/12 text-success"
                      : "border-transparent bg-destructive/12 text-destructive"
                  }
                >
                  {on ? "Enabled" : "Paused"}
                </Badge>
                <Button
                  size="sm"
                  variant={on ? "destructive" : "default"}
                  onClick={() => setPending(k)}
                >
                  {on ? "Pause" : "Resume"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
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
              {pending && state[pending.id] ? "Pause" : "Resume"}:{" "}
              {pending?.label}
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
            <Button variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={!valid} onClick={confirm}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
