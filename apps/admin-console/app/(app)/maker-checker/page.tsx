import type { ProposalDto } from "@app/contracts";
import { ProposalBoard } from "@/components/proposal-board";
import { requireAdminSession } from "@/lib/server/auth";
import { listProposals, ProposalApiError } from "@/lib/server/proposals-client";

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

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Maker-checker
        </h1>
        <p className="text-sm text-muted-foreground">
          Sensitive changes need a second operator to approve.
        </p>
      </div>

      {loadError ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Couldn&apos;t load proposals right now. Try again shortly.
        </p>
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
