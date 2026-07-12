import type { AdminSenderDto } from "@app/contracts";
import { SendersReviewBoard } from "@/components/senders-review-board";
import { requireAdminSession } from "@/lib/server/auth";
import { listSenderQueue, SenderApiError } from "@/lib/server/senders-client";

export default async function SendersPage() {
  const session = await requireAdminSession();
  const canManage = session.permissions.includes("staff:write");

  let senders: AdminSenderDto[] = [];
  let loadError = false;
  try {
    senders = (await listSenderQueue()).senders;
  } catch (error) {
    loadError = error instanceof SenderApiError || error instanceof Error;
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Sender IDs
        </h1>
        <p className="text-sm text-muted-foreground">
          Carrier/NCA review of customer sender-id registrations. Activation is
          the delivery gate for live traffic (MTN GH blocks unregistered senders
          since 2026-07-08).
        </p>
      </div>

      {loadError ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Couldn&apos;t load the review queue right now. Try again shortly.
        </p>
      ) : (
        <SendersReviewBoard senders={senders} canManage={canManage} />
      )}
    </div>
  );
}
