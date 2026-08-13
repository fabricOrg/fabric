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
  CardAction,
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@app/ui/components/ui/field";
import { Input } from "@app/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@app/ui/components/ui/select";
import { Separator } from "@app/ui/components/ui/separator";
import { StatCard } from "@app/ui/components/ui/stat-card";
import { formatUtcTimestamp } from "@app/ui/lib/datetime";
import { cn } from "@app/ui/lib/utils";
import {
  ArrowRight,
  Clock3,
  Plus,
  ShieldCheck,
  ShieldQuestion,
  UserCheck,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

const KIND_LABEL: Record<ProposalDto["kind"], string> = {
  wallet_adjustment: "Wallet adjustment",
  go_live: "Go-live (sandbox -> live)",
  plan_change: "Plan change",
  refund: "Refund",
};

const KIND_TONE: Record<ProposalDto["kind"], string> = {
  wallet_adjustment: "bg-warning/10 text-warning",
  go_live: "bg-success/10 text-success",
  plan_change: "bg-primary/10 text-primary",
  refund: "bg-destructive/10 text-destructive",
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
  const pending = proposals.filter((proposal) => proposal.status === "pending");
  const readyForYou = pending.filter(
    (proposal) => proposal.maker_email !== currentEmail,
  );
  const waitingOnPeer = pending.filter(
    (proposal) => proposal.maker_email === currentEmail,
  );

  async function decide(proposal: ProposalDto, decision: "approve" | "reject") {
    setBusyId(proposal.id);
    try {
      const response = await fetch(
        `/api/admin/proposals/${proposal.id}/decide`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision }),
        },
      );
      if (!response.ok) {
        throw new Error(
          await readError(response, "Couldn't record the decision."),
        );
      }
      toast.success(
        `${KIND_LABEL[proposal.kind]} ${
          decision === "approve" ? "approved" : "rejected"
        } for ${proposal.tenant_label}`,
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
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Pending queue" value={pending.length} icon={Clock3}>
          <p className="text-muted-foreground text-sm">
            Open proposals awaiting a final decision.
          </p>
        </StatCard>
        <StatCard
          label="Ready for you"
          value={readyForYou.length}
          icon={ShieldCheck}
          iconClassName="bg-success/10 text-success"
        >
          <p className="text-muted-foreground text-sm">
            Items you can approve or reject right now.
          </p>
        </StatCard>
        <StatCard
          label="Made by you"
          value={waitingOnPeer.length}
          icon={UserCheck}
          iconClassName="bg-warning/10 text-warning"
        >
          <p className="text-muted-foreground text-sm">
            Waiting for another operator to decide.
          </p>
        </StatCard>
      </div>

      {pending.length === 0 ? (
        <Card>
          <CardContent className="py-10">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ShieldQuestion />
                </EmptyMedia>
                <EmptyTitle>Queue clear</EmptyTitle>
                <EmptyDescription>
                  No proposals are waiting for review.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex flex-col gap-4">
            <ProposalSection
              title="Ready for your decision"
              description="Changes made by another operator that you can approve or reject."
              empty="No peer proposals need your decision."
            >
              {readyForYou.map((proposal) => (
                <ProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  canDecide={canManage}
                  busy={busyId === proposal.id}
                  onDecide={decide}
                />
              ))}
            </ProposalSection>

            {waitingOnPeer.length > 0 ? (
              <ProposalSection
                title="Waiting on another checker"
                description="You made these proposals, so separation of duties blocks your own approval."
              >
                {waitingOnPeer.map((proposal) => (
                  <ProposalCard
                    key={proposal.id}
                    proposal={proposal}
                    canDecide={false}
                    busy={busyId === proposal.id}
                    onDecide={decide}
                  />
                ))}
              </ProposalSection>
            ) : null}
          </div>

          <Alert className="h-fit">
            <Users />
            <AlertTitle>Two-person rule</AlertTitle>
            <AlertDescription>
              {/* AlertDescription is a grid; keep the sentence in one child so it flows inline. */}
              <p>
                You can only decide changes proposed by <em>another</em>{" "}
                operator. Every decision is logged with the actor.
              </p>
            </AlertDescription>
          </Alert>
        </div>
      )}
    </div>
  );
}

function ProposalSection({
  title,
  description,
  empty,
  children,
}: {
  title: string;
  description: string;
  empty?: string;
  children: ReactNode;
}) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  const isEmpty = Array.isArray(items) ? items.length === 0 : !items;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-sm">{title}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {isEmpty ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            {empty ?? "Nothing to review."}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">{items}</div>
      )}
    </section>
  );
}

function ProposalCard({
  proposal,
  canDecide,
  busy,
  onDecide,
}: {
  proposal: ProposalDto;
  canDecide: boolean;
  busy: boolean;
  onDecide: (
    proposal: ProposalDto,
    decision: "approve" | "reject",
  ) => Promise<void>;
}) {
  return (
    <Card className={cn("border-l-2", canDecide ? "border-l-success" : "")}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center border [&_svg]:size-3.5",
              KIND_TONE[proposal.kind],
            )}
            aria-hidden="true"
          >
            <ShieldQuestion />
          </span>
          <span className="min-w-0 truncate">
            {KIND_LABEL[proposal.kind]} · {proposal.tenant_label}
          </span>
        </CardTitle>
        <CardDescription>
          Proposed by <span className="font-mono">{proposal.maker_email}</span>{" "}
          · {formatUtcTimestamp(proposal.created_at)}
        </CardDescription>
        {canDecide ? (
          <CardAction className="flex gap-2">
            <Button
              size="sm"
              loading={busy}
              onClick={() => onDecide(proposal, "approve")}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onDecide(proposal, "reject")}
            >
              Reject
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <ValueBlock
            label="Before"
            muted
            value={proposal.before_value || "-"}
          />
          <ArrowRight className="hidden text-muted-foreground sm:block" />
          <ValueBlock label="After" value={proposal.after_value} />
        </div>
        <Separator />
        <div className="flex flex-col gap-1">
          <span className="font-medium text-[10px] text-muted-foreground uppercase">
            Reason
          </span>
          <p className="text-sm">{proposal.reason}</p>
        </div>
        {!canDecide ? (
          <p className="rounded-md border bg-muted/20 px-3 py-2 text-muted-foreground text-xs">
            Your own proposal needs a different operator.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ValueBlock({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="font-medium text-[10px] text-muted-foreground uppercase">
        {label}
      </span>
      <Badge
        variant="outline"
        className={cn(
          "max-w-full justify-start truncate rounded-md border-transparent",
          muted
            ? "bg-muted text-muted-foreground line-through"
            : "bg-success/12 text-success",
        )}
      >
        {value}
      </Badge>
    </div>
  );
}

export function NewProposalDialog({
  tenants,
  tenantsFailed = false,
}: {
  tenants: readonly { tenant_id: string; name: string }[];
  /**
   * The tenant list is fetched best-effort so a hiccup there does not block reviewing the queue -
   * but that leaves THREE states an empty array cannot tell apart: loaded-and-empty means no tenants
   * exist, failed means we do not know. Without this flag both render as a select you can open and
   * find nothing in, saying nothing about which one happened.
   */
  tenantsFailed?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ProposalDto["kind"]>("wallet_adjustment");
  const [tenantId, setTenantId] = useState("");
  const [before, setBefore] = useState("");
  const [after, setAfter] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  // The target must still be RESOLVABLE, not merely non-empty. `tenantId` is client state that
  // survives a re-render, so a refresh that fails or empties the tenant list would otherwise leave
  // the select disabled while submit stayed enabled - posting a stale id with an empty
  // `tenant_label` into the maker-checker queue, which is the audit-sensitive path.
  const selectedTenant = tenants.find((t) => t.tenant_id === tenantId) ?? null;
  const valid =
    selectedTenant !== null &&
    !tenantsFailed &&
    after.trim().length > 0 &&
    reason.trim().length >= 8;

  let tenantHint: ReactNode = null;
  if (tenantsFailed) {
    tenantHint = (
      <FieldError>
        Couldn&apos;t load the tenant list, so a proposal can&apos;t be targeted
        right now. Reviewing and approving existing proposals still works -
        reload to try again.
      </FieldError>
    );
  } else if (tenants.length === 0) {
    tenantHint = (
      <FieldDescription>
        No tenants exist yet, so there is nothing to target.
      </FieldDescription>
    );
  }

  async function submit() {
    // `valid` gates the button, but state can change between render and click. Resolving the tenant
    // here rather than falling back to an empty label means an unresolvable target cannot be posted.
    if (!selectedTenant) return;
    setBusy(true);
    try {
      // Send the real tenant_id from the select plus its name as the label the queue renders.
      const response = await fetch("/api/admin/proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          tenant_id: selectedTenant.tenant_id,
          tenant_label: selectedTenant.name,
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
      toast.success("Proposal created - awaiting a second operator");
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
              onValueChange={(value) => setKind(value as ProposalDto["kind"])}
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
            <Select
              value={tenantId}
              onValueChange={setTenantId}
              disabled={tenantsFailed || tenants.length === 0}
            >
              <SelectTrigger id="p-tenant">
                <SelectValue
                  placeholder={
                    tenantsFailed
                      ? "Tenant list unavailable"
                      : "Select a tenant"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {tenants.map((tenant) => (
                  <SelectItem key={tenant.tenant_id} value={tenant.tenant_id}>
                    {tenant.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tenantHint}
          </Field>
          <div className="flex gap-3">
            <Field className="flex-1">
              <FieldLabel htmlFor="p-before">Before</FieldLabel>
              <Input
                id="p-before"
                value={before}
                onChange={(event) => setBefore(event.target.value)}
                placeholder="e.g. GHS 1,204.03"
              />
            </Field>
            <Field className="flex-1">
              <FieldLabel htmlFor="p-after">After</FieldLabel>
              <Input
                id="p-after"
                value={after}
                onChange={(event) => setAfter(event.target.value)}
                placeholder="e.g. GHS 1,254.03"
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="p-reason">Reason (min 8 chars)</FieldLabel>
            <Input
              id="p-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
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
