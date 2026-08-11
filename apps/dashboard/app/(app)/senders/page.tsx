"use client";

import { PageContainer } from "@app/ui/components/ui/app-shell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@app/ui/components/ui/empty";
import {
  PageHeaderActions,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
  PageHeader as UIPageHeader,
} from "@app/ui/components/ui/page-header";
import { Skeleton } from "@app/ui/components/ui/skeleton";
import { IdCard } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { RegisterSenderDialog } from "@/components/forms/register-sender-dialog";
import { SenderIdTable } from "@/components/tables/sender-id-table";
import {
  listSenders,
  type RegisterSenderInput,
  registerSender,
  type SenderId,
} from "@/lib/client/senders-api";
import { toastApiError } from "@/lib/error-toast";

function PageHeader({ action }: { action?: ReactNode }) {
  return (
    <UIPageHeader>
      <PageHeaderHeading>
        <PageHeaderTitle>Sender IDs</PageHeaderTitle>
        <PageHeaderDescription className="max-w-2xl">
          Sender IDs must be registered before you can send. Nigeria requires
          registered sender IDs — unregistered messages are rejected by the
          carrier.
        </PageHeaderDescription>
      </PageHeaderHeading>
      {action ? <PageHeaderActions>{action}</PageHeaderActions> : null}
    </UIPageHeader>
  );
}

export default function SendersPage() {
  const searchParams = useSearchParams();
  // `null` = still loading (distinct from an empty list).
  const [senders, setSenders] = useState<SenderId[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    listSenders()
      .then((rows) => {
        if (live) setSenders(rows);
      })
      .catch((payload) => {
        if (!live) return;
        setFailed(true);
        setSenders([]);
        toastApiError(payload);
      });
    return () => {
      live = false;
    };
  }, []);

  async function handleRegister(input: RegisterSenderInput) {
    const optimistic: SenderId = {
      id: `optimistic-${crypto.randomUUID()}`,
      senderId: input.senderId,
      status: "pending",
      country: input.country,
      type: input.type,
      useCase: input.useCase,
      submittedAt: new Date().toISOString(),
    };
    setSenders((prev) => [optimistic, ...(prev ?? [])]);

    try {
      const created = await registerSender(input);
      setSenders((prev) =>
        (prev ?? []).map((s) => (s.id === optimistic.id ? created : s)),
      );
      toast.success(`${created.senderId} submitted for review`, {
        description: "You'll see it go active once the carrier approves it.",
      });
    } catch (payload) {
      setSenders((prev) => (prev ?? []).filter((s) => s.id !== optimistic.id));
      toastApiError(payload);
      throw payload;
    }
  }

  const registerAction = <RegisterSenderDialog onRegister={handleRegister} />;

  return (
    <PageContainer>
      <PageHeader action={senders !== null ? registerAction : undefined} />

      {senders === null ? (
        <LoadingState />
      ) : senders.length === 0 ? (
        <Empty className="min-h-64 rounded-lg border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IdCard />
            </EmptyMedia>
            <EmptyTitle>
              {failed ? "Couldn't load your sender IDs" : "No sender IDs yet"}
            </EmptyTitle>
            <EmptyDescription>
              {failed
                ? "We hit a problem fetching your sender IDs. Try again shortly."
                : "Register a sender ID to start sending. Approval takes 1–5 business days."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Your sender IDs</CardTitle>
              <CardDescription>
                Filter by status or country. A rejected request shows the
                carrier's reason and resubmits with its original values.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SenderIdTable
                senders={senders}
                initialStatus={
                  searchParams.get("status") === "rejected"
                    ? "rejected"
                    : undefined
                }
                rowAction={(sender) => (
                  <RegisterSenderDialog
                    onRegister={handleRegister}
                    initialValues={{
                      senderId: sender.senderId,
                      country: sender.country,
                      type: sender.type,
                      useCase: sender.useCase,
                    }}
                    triggerLabel="Correct and resubmit"
                    title={`Resubmit ${sender.senderId}`}
                  />
                )}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </PageContainer>
  );
}

function LoadingState() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-72" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-9 w-48" />
        </div>
        {["a", "b", "c", "d"].map((row) => (
          <Skeleton key={row} className="h-12 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}
