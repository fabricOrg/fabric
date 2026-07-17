import type { MessageDelivery } from "@app/contracts";
import { PageContainer } from "@app/ui/components/ui/app-shell";
import { Badge } from "@app/ui/components/ui/badge";
import {
  PageHeader,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import { ErrorState } from "@app/ui/components/ui/states";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@app/ui/components/ui/table";
import Link from "next/link";
import { BffError } from "@/lib/server/api-client";
import { listApplications } from "@/lib/server/applications-client";
import { requireDashboardSession } from "@/lib/server/auth";
import { retrieveMessageDelivery } from "@/lib/server/message-deliveries-client";

const STATUS_STYLE: Record<string, string> = {
  delivered: "border-transparent bg-success/12 text-success",
  sent: "border-transparent bg-success/12 text-success",
  accepted: "border-transparent bg-muted text-muted-foreground",
  processing: "border-transparent bg-muted text-muted-foreground",
  undelivered: "border-transparent bg-destructive/12 text-destructive",
  failed: "border-transparent bg-destructive/12 text-destructive",
  expired: "border-transparent bg-destructive/12 text-destructive",
};

/** The dashboard is an operator surface — show the number's shape, not the number. */
function maskRecipient(recipient: string): string {
  if (recipient === "redacted" || recipient.length < 9) return "redacted";
  return `${recipient.slice(0, 4)}•••${recipient.slice(-4)}`;
}

function FactRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b py-2 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono text-sm">{value}</dd>
    </div>
  );
}

function AttemptTimeline({ delivery }: { delivery: MessageDelivery }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>#</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Cost</TableHead>
          <TableHead>Message</TableHead>
          <TableHead>Error</TableHead>
          <TableHead>Updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {delivery.attempts.map((attempt) => (
          <TableRow key={attempt.id}>
            <TableCell className="tabular-nums">{attempt.ordinal}</TableCell>
            <TableCell>
              <Badge variant="outline" className={STATUS_STYLE[attempt.status]}>
                {attempt.status}
              </Badge>
            </TableCell>
            <TableCell className="tabular-nums">
              {attempt.cost.minor} minor {attempt.cost.currency}
            </TableCell>
            <TableCell className="font-mono text-xs">
              {attempt.message_id ?? "—"}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {attempt.error_code ?? "—"}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {new Date(attempt.updated_at).toLocaleString()}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default async function MessageDeliveryDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ application?: string }>;
}) {
  await requireDashboardSession();
  const { id } = await params;
  const requestedApplication = (await searchParams).application;

  let delivery: MessageDelivery | undefined;
  let requestId: string | undefined;
  let loadError = false;
  try {
    const { applications } = await listApplications();
    const application =
      applications.find((a) => a.slug === requestedApplication) ??
      applications[0];
    const sandbox = application?.environments.find(
      (environment) => environment.type === "sandbox",
    );
    if (application && sandbox) {
      const response = await retrieveMessageDelivery(
        id,
        application.id,
        sandbox.id,
      );
      delivery = response.delivery;
      requestId = response.request_id;
    }
  } catch (error) {
    loadError = error instanceof BffError || error instanceof Error;
  }

  if (loadError || !delivery) {
    return (
      <PageContainer>
        <ErrorState
          title="Couldn't load this delivery"
          message="It may belong to another application, or the messaging service is unavailable."
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitle>
            <span className="font-mono">{delivery.key}</span>{" "}
            <Badge variant="outline" className={STATUS_STYLE[delivery.status]}>
              {delivery.status}
            </Badge>
          </PageHeaderTitle>
          <PageHeaderDescription>
            One durable managed delivery — its identity, cost, and every
            provider attempt.{" "}
            <Link href="/message-deliveries" className="underline">
              Back to deliveries
            </Link>
          </PageHeaderDescription>
        </PageHeaderHeading>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-2">
        <dl className="rounded-xl border bg-card p-5">
          <FactRow label="Delivery id" value={delivery.id} />
          <FactRow label="Version" value={delivery.version_id} />
          <FactRow label="Environment" value={delivery.environment} />
          <FactRow label="Locale" value={delivery.locale} />
          <FactRow
            label="Recipient"
            value={maskRecipient(delivery.recipient)}
          />
          <FactRow label="Reference" value={delivery.reference ?? "—"} />
          <FactRow
            label="Total cost"
            value={`${delivery.cost.minor} minor ${delivery.cost.currency}`}
          />
          <FactRow
            label="Resource version"
            value={String(delivery.resource_version)}
          />
          <FactRow
            label="Created"
            value={new Date(delivery.created_at).toLocaleString()}
          />
          {requestId ? <FactRow label="Request id" value={requestId} /> : null}
        </dl>

        <div className="rounded-xl border bg-card">
          <p className="border-b p-4 text-sm font-medium">Attempts</p>
          <AttemptTimeline delivery={delivery} />
        </div>
      </div>

      {Object.keys(delivery.metadata).length > 0 ? (
        <div className="mt-6 rounded-xl border bg-card p-5">
          <p className="mb-2 text-sm font-medium">Metadata</p>
          <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">
            <code>{JSON.stringify(delivery.metadata, null, 2)}</code>
          </pre>
        </div>
      ) : null}
    </PageContainer>
  );
}
