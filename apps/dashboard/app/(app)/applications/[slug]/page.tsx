import type {
  ApiKey,
  ApiKeyEnv,
  ListRequestLogsResponse,
  WebhookEndpointDto,
} from "@app/contracts";
import { PageContainer } from "@app/ui/components/ui/app-shell";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
} from "@app/ui/components/ui/card";
import {
  PageHeader,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import { ErrorState } from "@app/ui/components/ui/states";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@app/ui/components/ui/tabs";
import { notFound } from "next/navigation";
import { ApiKeysPanel } from "@/components/api-keys-panel";
import { CreateWebhookDialog } from "@/components/forms/create-webhook-dialog";
import { RequestLogsTable } from "@/components/tables/request-logs-table";
import { WebhooksTable } from "@/components/tables/webhooks-table";
import { BffError } from "@/lib/server/api-client";
import { listApiKeys } from "@/lib/server/api-keys-client";
import { listApplications } from "@/lib/server/applications-client";
import { requireDashboardSession } from "@/lib/server/auth";
import { listRequestLogs } from "@/lib/server/request-logs-client";
import { listWebhooks } from "@/lib/server/webhooks-client";

/** The resource tabs (API keys · Webhooks · Logs) for ONE environment. The environment itself is
 *  chosen by the outer switcher — this renders the selected env's resources. `env` is the api-key
 *  environment (sandbox/live), shared by keys, webhooks, and logs. */
function EnvironmentResources({
  env,
  applicationId,
  keys,
  webhooks,
  logs,
  liveActive,
  canManage,
}: {
  env: ApiKeyEnv;
  applicationId: string;
  keys: ApiKey[];
  webhooks: WebhookEndpointDto[];
  logs: ListRequestLogsResponse;
  liveActive: boolean;
  canManage: boolean;
}) {
  const webhookEnv = env === "live" ? "live" : "sandbox";
  return (
    <Tabs defaultValue="keys" className="gap-4">
      <TabsList>
        <TabsTrigger value="keys">API keys</TabsTrigger>
        <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
        <TabsTrigger value="logs">Logs</TabsTrigger>
      </TabsList>

      <TabsContent value="keys">
        <Card>
          <ApiKeysPanel
            keys={keys}
            applicationId={applicationId}
            liveActive={liveActive}
            defaultEnv={env}
            canManage={canManage}
          />
        </Card>
      </TabsContent>

      <TabsContent value="webhooks">
        <Card>
          <CardHeader>
            <CardDescription>
              Signed event deliveries for this environment.
            </CardDescription>
            {canManage ? (
              <CardAction>
                <CreateWebhookDialog
                  applicationId={applicationId}
                  env={webhookEnv}
                />
              </CardAction>
            ) : null}
          </CardHeader>
          <CardContent>
            <WebhooksTable endpoints={webhooks} />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="logs">
        <Card>
          <CardHeader>
            <CardDescription>
              Every API request made with this environment&apos;s keys, newest
              first. Metadata only, retained for a limited window.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RequestLogsTable
              initialLogs={logs.logs}
              initialCursor={logs.next_cursor}
              applicationId={applicationId}
              env={webhookEnv}
            />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
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

  // Which environment the page shows follows the workspace's mode: the topbar Virtual/Live toggle is
  // the ONE environment switcher (no per-page duplicate). A sandbox workspace shows its sandbox env;
  // once go-live flips the workspace live, the live env's resources show.
  const env: ApiKeyEnv = session.plan === "sandbox" ? "sandbox" : "live";
  const envType = env === "live" ? "live" : "sandbox";
  // Whether go-live has unlocked the live environment — gates the keys tab's Test/Live switch.
  const liveActive =
    app.environments.find((e) => e.type === "live")?.status === "active";

  const emptyLogs: ListRequestLogsResponse = { logs: [], next_cursor: null };
  let keys: ApiKey[] = [];
  let webhooks: WebhookEndpointDto[] = [];
  let logs: ListRequestLogsResponse = emptyLogs;
  let loadError = false;
  if (canRead) {
    try {
      [keys, webhooks, logs] = await Promise.all([
        listApiKeys(app.id),
        listWebhooks(app.id),
        listRequestLogs(app.id, envType),
      ]);
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
            — API keys, webhooks, and logs for the environment selected in the
            top bar.
          </PageHeaderDescription>
        </PageHeaderHeading>
      </PageHeader>

      {!canRead ? (
        <ErrorState
          title="You don't have access to this application"
          message="Ask a workspace owner or admin for developer access."
        />
      ) : loadError ? (
        <ErrorState
          title="Couldn't load this application"
          message="The developer service is temporarily unavailable. Refresh the page to try again."
        />
      ) : (
        <EnvironmentResources
          env={env}
          applicationId={app.id}
          keys={keys}
          webhooks={webhooks.filter((w) => w.env === envType)}
          logs={logs}
          liveActive={liveActive}
          canManage={canManage}
        />
      )}
    </PageContainer>
  );
}
