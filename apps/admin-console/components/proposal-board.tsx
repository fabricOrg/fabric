"use client";

import type { ProposalDto } from "@app/contracts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@app/ui/components/ui/alert";
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
  DialogTrigger,
} from "@app/ui/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@app/ui/components/ui/empty";
import { Field, FieldLabel } from "@app/ui/components/ui/field";
import { Input } from "@app/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { formatUtcTimestamp } from "@app/ui/lib/datetime";
import { ArrowRight, Plus, ShieldQuestion, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

const KIND_LABEL: Record<ProposalDto["kind"], string> = {
  wallet_adjustment: "Wallet adjustment",
  go_live: "Go-live (sandbox → live)",
  plan_change: "Plan change",
  refund: "Refund",
};

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

export function ProposalBoard({
  proposals,
  currentEmail,
  canManage,
}: {
  proposals: readonly ProposalDto[];
  currentEmail: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const pending = proposals.filter((p) => p.status === "pending");

  async function decide(p: ProposalDto, decision: "approve" | "reject") {
    setBusyId(p.id);
    try {
      const response = await fetch(`/api/admin/proposals/${p.id}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!response.ok) {
        throw new Error(
          await readError(response, "Couldn't record the decision."),
        );
      }
      toast.success(
        `${KIND_LABEL[p.kind]} ${decision === "approve" ? "approved" : "rejected"} for ${p.tenant_label}`,
      );
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

  return (
    <div className="flex flex-col gap-6">
      <Alert>
        <Users />
        <AlertTitle>Two-person rule</AlertTitle>
        <AlertDescription>
          {/* AlertDescription is a grid — bare text split by <em> becomes separate rows. Keep it
              one <p> so the sentence flows inline. */}
          <p>
            You can only decide changes proposed by <em>another</em> operator —
            never your own. Every decision is logged with the actor.
          </p>
        </AlertDescription>
      </Alert>

      {pending.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ShieldQuestion />
            </EmptyMedia>
            <EmptyTitle>Queue clear</EmptyTitle>
            <EmptyDescription>No proposals awaiting review.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-4">
          {pending.map((p) => {
            const own = p.maker_email === currentEmail;
            return (
              <Card key={p.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldQuestion className="size-4 text-muted-foreground" />
                    {KIND_LABEL[p.kind]} · {p.tenant_label}
                  </CardTitle>
                  <CardDescription>
                    Proposed by{" "}
                    <span className="font-mono">{p.maker_email}</span> ·{" "}
                    {formatUtcTimestamp(p.created_at)}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                    <Badge
                      variant="outline"
                      className="border-transparent bg-muted text-muted-foreground line-through"
                    >
                      {p.before_value || "—"}
                    </Badge>
                    <ArrowRight className="size-4 text-muted-foreground" />
                    <Badge
                      variant="outline"
                      className="border-transparent bg-success/12 text-success"
                    >
                      {p.after_value}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">Reason:</span>{" "}
                    {p.reason}
                  </p>
                  {canManage ? (
                    own ? (
                      <p className="text-xs text-muted-foreground">
                        Your own proposal — another admin must decide.
                      </p>
                    ) : (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          loading={busyId === p.id}
                          onClick={() => decide(p, "approve")}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === p.id}
                          onClick={() => decide(p, "reject")}
                        >
                          Reject
                        </Button>
                      </div>
                    )
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function NewProposalDialog({
  tenants,
}: {
  tenants: readonly { tenant_id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ProposalDto["kind"]>("wallet_adjustment");
  const [tenantId, setTenantId] = useState("");
  const [before, setBefore] = useState("");
  const [after, setAfter] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const valid =
    tenantId.length > 0 && after.trim().length > 0 && reason.trim().length >= 8;

  async function submit() {
    setBusy(true);
    try {
      // Send the real tenant_id from the select plus its name as the label the queue renders.
      const selected = tenants.find((t) => t.tenant_id === tenantId);
      const response = await fetch("/api/admin/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          tenant_id: tenantId,
          tenant_label: selected?.name ?? "",
          before_value: before.trim(),
          after_value: after.trim(),
          reason: reason.trim(),
        }),
      });
      if (!response.ok) {
        throw new Error(
          await readError(response, "Couldn't create the proposal."),
        );
      }
      toast.success("Proposal created — awaiting a second operator");
      setOpen(false);
      setTenantId("");
      setBefore("");
      setAfter("");
      setReason("");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Couldn't create the proposal.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus data-icon="inline-start" />
          New proposal
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Propose a change</DialogTitle>
          <DialogDescription>
            Another admin approves it. The proposal and its decision are
            audited.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <Field>
            <FieldLabel htmlFor="p-kind">Kind</FieldLabel>
            <Select
              value={kind}
              onValueChange={(v) => setKind(v as ProposalDto["kind"])}
            >
              <SelectTrigger id="p-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="wallet_adjustment">
                  Wallet adjustment
                </SelectItem>
                <SelectItem value="plan_change">Plan change</SelectItem>
                <SelectItem value="refund">Refund</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="p-tenant">Tenant</FieldLabel>
            <Select value={tenantId} onValueChange={setTenantId}>
              <SelectTrigger id="p-tenant">
                <SelectValue placeholder="Select a tenant" />
              </SelectTrigger>
              <SelectContent>
                {tenants.map((t) => (
                  <SelectItem key={t.tenant_id} value={t.tenant_id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex gap-3">
            <Field className="flex-1">
              <FieldLabel htmlFor="p-before">Before</FieldLabel>
              <Input
                id="p-before"
                value={before}
                onChange={(e) => setBefore(e.target.value)}
                placeholder="e.g. GHS 1,204.03"
              />
            </Field>
            <Field className="flex-1">
              <FieldLabel htmlFor="p-after">After</FieldLabel>
              <Input
                id="p-after"
                value={after}
                onChange={(e) => setAfter(e.target.value)}
                placeholder="e.g. GHS 1,254.03"
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="p-reason">Reason (min 8 chars)</FieldLabel>
            <Input
              id="p-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Justification for the audit log"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button disabled={!valid} loading={busy} onClick={submit}>
            Create proposal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
