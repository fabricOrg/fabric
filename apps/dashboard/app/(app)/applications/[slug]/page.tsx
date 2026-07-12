import type { ApiKey, ApiKeyEnv } from "@app/contracts";
import { PageContainer } from "@app/ui/components/ui/app-shell";
import { Badge } from "@app/ui/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@app/ui/components/ui/card";
import {
  PageHeader,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import { ErrorState } from "@app/ui/components/ui/states";
import { notFound } from "next/navigation";
import { CreateApiKeyDialog } from "@/components/forms/create-api-key-dialog";
import { ApiKeysTable } from "@/components/tables/api-keys-table";
import { BffError } from "@/lib/server/api-client";
import { listApiKeys } from "@/lib/server/api-keys-client";
import { listApplications } from "@/lib/server/applications-client";
import { requireDashboardSession } from "@/lib/server/auth";

/** One (active) environment's keys: status header + create + its key list. Only rendered for an
 *  active environment — a locked live env is hidden entirely, not shown as an unusable table. */
function EnvironmentSection({
  title,
  env,
  applicationId,
  keys,
  canManage,
}: {
  title: string;
  env: ApiKeyEnv;
  applicationId: string;
  keys: ApiKey[];
  canManage: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {title}
          <Badge
            variant="outline"
            className="border-transparent bg-success/12 text-success"
          >
            Active
          </Badge>
        </CardTitle>
        <CardDescription>
          {env === "live"
            ? "Live keys spend real money and deliver to carriers."
            : "Sandbox keys are free and never reach a carrier."}
        </CardDescription>
        {canManage ? (
          <CardAction>
            <CreateApiKeyDialog applicationId={applicationId} env={env} />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        <ApiKeysTable keys={keys} />
      </CardContent>
    </Card>
  );
}

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await requireDashboardSession();
  const canRead = session.permissions.includes("api_keys:read");
  const canManage = session.permissions.includes("api_keys:write");

  const { applications } = await listApplications();
  const app = applications.find((a) => a.slug === slug);
  if (!app) notFound();

  const liveEnv = app.environments.find((e) => e.type === "live");

  let keys: ApiKey[] = [];
  let loadError = false;
  if (canRead) {
    try {
      keys = await listApiKeys(app.id);
    } catch (error) {
      loadError = error instanceof BffError || error instanceof Error;
    }
  }

  return (
    <PageContainer>
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitle>{app.name}</PageHeaderTitle>
          <PageHeaderDescription>
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {app.slug}
            </code>{" "}
            — API keys are scoped to an environment below.
          </PageHeaderDescription>
        </PageHeaderHeading>
      </PageHeader>

      {!canRead ? (
        <ErrorState
          title="You don't have access to API keys"
          message="Ask a workspace owner or admin for developer access."
        />
      ) : loadError ? (
        <ErrorState
          title="Couldn't load API keys"
          message="The keys service is temporarily unavailable. Refresh the page to try again."
        />
      ) : (
        <div className="flex flex-col gap-6">
          <EnvironmentSection
            title="Sandbox"
            env="test"
            applicationId={app.id}
            keys={keys.filter((k) => k.env === "test")}
            canManage={canManage}
          />
          {/* The live environment is hidden entirely until go-live unlocks it — a workspace in
              sandbox mode never sees a live keys table it can't use. It appears once live is active. */}
          {liveEnv?.status === "active" ? (
            <EnvironmentSection
              title="Live"
              env="live"
              applicationId={app.id}
              keys={keys.filter((k) => k.env === "live")}
              canManage={canManage}
            />
          ) : null}
        </div>
      )}
    </PageContainer>
  );
}
