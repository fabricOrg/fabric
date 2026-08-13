import type { ProposalDto, TenantSummaryDto } from "@app/contracts";
import { PageContainer } from "@app/ui/components/ui/app-shell";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@app/ui/components/ui/empty";
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
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
  // reviewing the queue. Best-effort is NOT silent: swallowing the failure into `[]` made a broken
  // fetch indistinguishable from "no tenants exist", and the operator got an empty select with no
  // explanation for why they couldn't file anything. The flag is what lets the dialog say which.
  let tenants: TenantSummaryDto[] = [];
  let tenantsFailed = false;
  if (canManage) {
    try {
      tenants = (await listTenants()).tenants;
    } catch {
      tenantsFailed = true;
    }
  }

  return (
    <PageContainer>
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitle>Maker-checker</PageHeaderTitle>
          <PageHeaderDescription>
            Sensitive changes need a second operator to approve.
          </PageHeaderDescription>
        </PageHeaderHeading>
        {canManage ? (
          <PageHeaderActions>
            <NewProposalDialog
              tenants={tenants}
              tenantsFailed={tenantsFailed}
            />
          </PageHeaderActions>
        ) : null}
      </PageHeader>

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
    </PageContainer>
  );
}
