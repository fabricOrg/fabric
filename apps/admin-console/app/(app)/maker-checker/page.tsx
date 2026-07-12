import type { ProposalDto, TenantSummaryDto } from "@app/contracts";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@app/ui/components/ui/empty";
import { TriangleAlert } from "lucide-react";
import { NewProposalDialog, ProposalBoard } from "@/components/proposal-board";
import { requireAdminSession } from "@/lib/server/auth";
import { listProposals, ProposalApiError } from "@/lib/server/proposals-client";
import { listTenants } from "@/lib/server/tenants-client";

export default async function MakerCheckerPage() {
  const session = await requireAdminSession();
  const canManage = session.permissions.includes("staff:write");

  let proposals: ProposalDto[] = [];
  let loadError = false;
  try {
    proposals = (await listProposals()).proposals;
  } catch (error) {
    loadError = error instanceof ProposalApiError || error instanceof Error;
  }

  // Tenants populate the proposal target select — best-effort so a tenant-list hiccup doesn't block
  // reviewing the queue; the dialog just falls back to an empty select.
  let tenants: TenantSummaryDto[] = [];
  if (canManage) {
    try {
      tenants = (await listTenants()).tenants;
    } catch {
      tenants = [];
    }
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Maker-checker
          </h1>
          <p className="text-sm text-muted-foreground">
            Sensitive changes need a second operator to approve.
          </p>
        </div>
        {canManage ? <NewProposalDialog tenants={tenants} /> : null}
      </div>

      {loadError ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TriangleAlert />
            </EmptyMedia>
            <EmptyTitle>Couldn&apos;t load proposals</EmptyTitle>
            <EmptyDescription>
              Something went wrong reaching the control plane. Try again
              shortly.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ProposalBoard
          proposals={proposals}
          currentEmail={session.email ?? ""}
          canManage={canManage}
        />
      )}
    </div>
  );
}
