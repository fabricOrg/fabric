"use client";

import type { AdminSenderDto } from "@app/contracts";
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
import { CheckCircle2, Radio, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

interface ErrorPayload {
  error?: { message?: string };
}

async function readError(
  response: Response,
  fallback: string,
): Promise<string> {
  const payload = (await response
    .json()
    .catch(() => null)) as ErrorPayload | null;
  return payload?.error?.message ?? fallback;
}

/**
 * Sender-ID review queue (E10). Approval activates the registration — from that moment the
 * tenant's LIVE sends with this sender id pass the send-time gate. Rejection requires a reason
 * the customer will see on their Senders screen.
 */
export function SendersReviewBoard({
  senders,
  canManage,
}: {
  senders: readonly AdminSenderDto[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<AdminSenderDto | null>(null);
  const [reason, setReason] = useState("");

  const pending = senders.filter((s) => s.status === "pending");
  const decided = senders.filter((s) => s.status !== "pending").slice(0, 20);

  async function decide(
    sender: AdminSenderDto,
    status: "active" | "rejected",
    decisionReason?: string,
  ) {
    setBusyId(sender.id);
    try {
      const response = await fetch(`/api/admin/senders/${sender.id}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status,
          ...(decisionReason ? { reason: decisionReason } : {}),
        }),
      });
      if (!response.ok) {
        throw new Error(
          await readError(response, "Couldn't record the decision."),
        );
      }
      toast.success(
        `Sender '${sender.sender_id}' (${sender.country}) ${status === "active" ? "activated" : "rejected"}`,
      );
      setRejecting(null);
      setReason("");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Couldn't record the decision.",
      );
    } finally {
      setBusyId(null);
    }
  }

  if (senders.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          No sender registrations yet. They appear here as customers submit
          them.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Radio className="size-4" /> Awaiting review ({pending.length})
          </CardTitle>
          <CardDescription>
            Activation gates delivery: live sends with an unapproved sender id
            are blocked at send time.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {pending.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Queue is clear.
            </p>
          ) : (
            pending.map((s) => (
              <div
                key={s.id}
                className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold">
                      {s.sender_id}
                    </span>
                    <Badge variant="outline">{s.country}</Badge>
                    <Badge variant="secondary">{s.type}</Badge>
                  </div>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {s.use_case}
                  </p>
                </div>
                {canManage ? (
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      disabled={busyId === s.id}
                      onClick={() => decide(s, "active")}
                    >
                      <CheckCircle2 data-icon="inline-start" /> Activate
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === s.id}
                      onClick={() => setRejecting(s)}
                    >
                      <XCircle data-icon="inline-start" /> Reject
                    </Button>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recently decided</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {decided.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Nothing decided yet.
            </p>
          ) : (
            decided.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono">{s.sender_id}</span>
                  <Badge variant="outline">{s.country}</Badge>
                </div>
                <Badge
                  variant={s.status === "active" ? "default" : "destructive"}
                >
                  {s.status}
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog
        open={rejecting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRejecting(null);
            setReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Reject '{rejecting?.sender_id}' ({rejecting?.country})
            </DialogTitle>
            <DialogDescription>
              The customer sees this reason on their Senders screen — say what
              to fix (e.g. brand conflict, missing docs).
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="reject-reason">Reason</FieldLabel>
            <Input
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Too similar to a protected brand — resubmit with a distinct name."
            />
          </Field>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={
                reason.trim().length < 4 ||
                (rejecting !== null && busyId === rejecting.id)
              }
              onClick={() => {
                if (rejecting) decide(rejecting, "rejected", reason.trim());
              }}
            >
              Reject registration
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
