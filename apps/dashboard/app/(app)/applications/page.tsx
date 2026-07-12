import type { ApplicationDto, EnvironmentDto } from "@app/contracts";
import { PageContainer } from "@app/ui/components/ui/app-shell";
import { Badge } from "@app/ui/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import { ErrorState, TableEmptyState } from "@app/ui/components/ui/states";
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
  const envs = [...application.environments].sort((a, b) =>
    a.type.localeCompare(b.type),
  );
  const created = new Date(application.created_at).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{application.name}</CardTitle>
        <CardDescription>
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
            {application.slug}
          </code>
          <span className="ml-2 text-xs text-muted-foreground">
            Created {created}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-1.5">
          {envs.map((env) => (
            <EnvironmentBadge key={env.id} env={env} />
          ))}
        </div>
      </CardContent>
    </Card>
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
