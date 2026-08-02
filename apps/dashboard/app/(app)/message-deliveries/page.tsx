import type { MessageDeliverySummary } from "@app/contracts";
import { PageContainer } from "@app/ui/components/ui/app-shell";
import { Badge } from "@app/ui/components/ui/badge";
import {
  PageHeader,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import { ErrorState, TableEmptyState } from "@app/ui/components/ui/states";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@app/ui/components/ui/table";
import { formatDateTimeFull } from "@app/ui/lib/datetime";
import Link from "next/link";
import { DefinitionApplicationSelector } from "@/components/message-definitions/definition-application-selector";
import { BffError } from "@/lib/server/api-client";
import { listApplications } from "@/lib/server/applications-client";
import { requireDashboardSession } from "@/lib/server/auth";
import { listMessageDeliveries } from "@/lib/server/message-deliveries-client";

const STATUS_STYLE: Record<string, string> = {
  delivered: "border-transparent bg-success/12 text-success",
  sent: "border-transparent bg-success/12 text-success",
  accepted: "border-transparent bg-muted text-muted-foreground",
  processing: "border-transparent bg-muted text-muted-foreground",
  undelivered: "border-transparent bg-destructive/12 text-destructive",
  failed: "border-transparent bg-destructive/12 text-destructive",
  expired: "border-transparent bg-destructive/12 text-destructive",
};

function costLabel(cost: MessageDeliverySummary["cost"]): string {
  return `${cost.minor} minor ${cost.currency}`;
}

function DeliveriesTable({
  deliveries,
  applicationSlug,
}: {
  deliveries: MessageDeliverySummary[];
  applicationSlug: string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Key</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Locale</TableHead>
          <TableHead>Cost</TableHead>
          <TableHead>Reference</TableHead>
          <TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {deliveries.map((delivery) => (
          <TableRow key={delivery.id}>
            <TableCell className="font-mono text-xs">
              <Link
                href={`/message-deliveries/${delivery.id}?application=${encodeURIComponent(applicationSlug)}`}
                className="underline-offset-2 hover:underline"
              >
                {delivery.key}
              </Link>
            </TableCell>
            <TableCell>
              <Badge
                variant="outline"
                className={STATUS_STYLE[delivery.status]}
              >
                {delivery.status}
              </Badge>
            </TableCell>
            <TableCell>{delivery.locale}</TableCell>
            <TableCell className="tabular-nums">
              {costLabel(delivery.cost)}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {delivery.reference ?? "—"}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatDateTimeFull(delivery.created_at)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default async function MessageDeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<{ application?: string }>;
}) {
  await requireDashboardSession();

  const requestedApplication = (await searchParams).application;
  let deliveries: MessageDeliverySummary[] = [];
  let applications: Awaited<
    ReturnType<typeof listApplications>
  >["applications"] = [];
  let selectedApplication: (typeof applications)[number] | undefined;
  let loadError = false;
  try {
    applications = (await listApplications()).applications;
    selectedApplication =
      applications.find(
        (application) => application.slug === requestedApplication,
      ) ?? applications[0];
    const sandbox = selectedApplication?.environments.find(
      (environment) => environment.type === "sandbox",
    );
    if (sandbox) {
      deliveries = (await listMessageDeliveries(sandbox.id)).deliveries;
    }
  } catch (error) {
    loadError = error instanceof BffError || error instanceof Error;
  }

  return (
    <PageContainer>
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitle>Managed deliveries</PageHeaderTitle>
          <PageHeaderDescription>
            Every send by stable key: one durable delivery per Idempotency-Key,
            with its status, exact cost, and reference.
          </PageHeaderDescription>
        </PageHeaderHeading>
      </PageHeader>

      {applications.length > 0 && selectedApplication ? (
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Sandbox deliveries for one application, newest first.
          </p>
          <DefinitionApplicationSelector
            applications={applications}
            selectedSlug={selectedApplication.slug}
            basePath="/message-deliveries"
          />
        </div>
      ) : null}

      {loadError ? (
        <ErrorState
          title="Couldn't load deliveries"
          message="The messaging service is temporarily unavailable. Refresh to try again."
        />
      ) : applications.length === 0 ? (
        <TableEmptyState
          title="Create an application first"
          description="Managed deliveries belong to an application's sandbox environment."
        />
      ) : deliveries.length === 0 ? (
        <TableEmptyState
          title="No managed deliveries yet"
          description="Send a released definition by stable key with fabric.messages.send and it will appear here."
        />
      ) : (
        <div className="rounded-xl border bg-card">
          <DeliveriesTable
            deliveries={deliveries}
            applicationSlug={selectedApplication?.slug ?? ""}
          />
        </div>
      )}
    </PageContainer>
  );
}
