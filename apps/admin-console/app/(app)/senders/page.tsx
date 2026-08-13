import type { AdminSenderDto } from "@app/contracts";
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
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import { TriangleAlert } from "lucide-react";
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
    <PageContainer>
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitle>Sender IDs</PageHeaderTitle>
          <PageHeaderDescription>
            Carrier/NCA review of customer sender-id registrations. Activation
            is the delivery gate for live traffic (MTN GH blocks unregistered
            senders since 2026-07-08).
          </PageHeaderDescription>
        </PageHeaderHeading>
      </PageHeader>

      {loadError ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TriangleAlert />
            </EmptyMedia>
            <EmptyTitle>Couldn&apos;t load the review queue</EmptyTitle>
            <EmptyDescription>
              Something went wrong reaching the control plane. Try again
              shortly.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <SendersReviewBoard senders={senders} canManage={canManage} />
      )}
    </PageContainer>
  );
}
