import type { ApplicationDto, EnvironmentDto } from "@app/contracts";
import { PageContainer } from "@app/ui/components/ui/app-shell";
import { Badge } from "@app/ui/components/ui/badge";
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import { ErrorState, TableEmptyState } from "@app/ui/components/ui/states";
import { Boxes, Layers } from "lucide-react";
import Link from "next/link";
import { CreateApplicationDialog } from "@/components/forms/create-application-dialog";
import { BffError } from "@/lib/server/api-client";
import { listApplications } from "@/lib/server/applications-client";
import { requireDashboardSession } from "@/lib/server/auth";

const ENV_LABEL: Record<EnvironmentDto["type"], string> = {
  sandbox: "Sandbox",
  live: "Live",
};

/** Sandbox is always usable; a live env is `locked` until go-live unlocks it (ADR-0004). */
function EnvironmentBadge({ env }: { env: EnvironmentDto }) {
  const active = env.status === "active";
  const style = active
    ? "border-transparent bg-success/12 text-success"
    : "border-transparent bg-muted text-muted-foreground";
  return (
    <Badge variant="outline" className={style}>
      {ENV_LABEL[env.type]} · {active ? "Active" : "Locked"}
    </Badge>
  );
}

function ApplicationCard({ application }: { application: ApplicationDto }) {
  // Show only ACTIVE environments — a live env stays locked (and hidden) until go-live, so a
  // sandbox-only app reads as one environment, not two (matches the app-detail page).
  const envs = application.environments
    .filter((e) => e.status === "active")
    .sort((a, b) => a.type.localeCompare(b.type));
  const created = new Date(application.created_at).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return (
    <Link
      href={`/applications/${application.slug}`}
      className="flex flex-col gap-4 rounded-xl border bg-card p-5 text-card-foreground shadow-sm transition-colors hover:border-ring/40 hover:bg-accent/40"
    >
      {/* Header: icon tile + name over its slug (the app's stable identifier). */}
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Boxes className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold leading-tight">
            {application.name}
          </h3>
          <p className="truncate text-sm text-muted-foreground">
            {application.slug}
          </p>
        </div>
      </div>

      {/* Environment status — a sandbox always, a live env locked until go-live (ADR-0004). */}
      <div className="flex flex-wrap gap-1.5">
        {envs.map((env) => (
          <EnvironmentBadge key={env.id} env={env} />
        ))}
      </div>

      {/* Footer: environment count + created date, split by a divider. */}
      <div className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Layers className="size-3.5" />
          {envs.length} {envs.length === 1 ? "Environment" : "Environments"}
        </span>
        <span>
          Created <span className="font-medium text-foreground">{created}</span>
        </span>
      </div>
    </Link>
  );
}

export default async function ApplicationsPage() {
  const session = await requireDashboardSession();
  const canManage = session.role === "owner" || session.role === "admin";

  let applications: ApplicationDto[] = [];
  let loadError = false;
  try {
    applications = (await listApplications()).applications;
  } catch (error) {
    // A configured-but-unreachable API shouldn't blank the page — show an inline notice instead.
    loadError = error instanceof BffError || error instanceof Error;
  }

  return (
    <PageContainer>
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitle>Applications</PageHeaderTitle>
          <PageHeaderDescription>
            Each application groups your API keys, webhooks, and logs, and
            carries a sandbox and a live environment.
          </PageHeaderDescription>
        </PageHeaderHeading>
        {canManage ? (
          <PageHeaderActions>
            <CreateApplicationDialog />
          </PageHeaderActions>
        ) : null}
      </PageHeader>

      {loadError ? (
        <ErrorState
          title="Couldn't load applications"
          message="The applications service is temporarily unavailable. Refresh the page to try again."
        />
      ) : applications.length === 0 ? (
        <TableEmptyState
          title="No applications yet"
          description="Create your first application to start integrating. It begins with a sandbox environment you can build against right away."
          action={canManage ? <CreateApplicationDialog /> : undefined}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {applications.map((application) => (
            <ApplicationCard key={application.id} application={application} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}
