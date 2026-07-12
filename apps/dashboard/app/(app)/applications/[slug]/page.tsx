import type {
  ApiKey,
  ApiKeyEnv,
  ListRequestLogsResponse,
  WebhookEndpointDto,
} from "@app/contracts";
import { PageContainer } from "@app/ui/components/ui/app-shell";
import { Badge } from "@app/ui/components/ui/badge";
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
import { CreateApiKeyDialog } from "@/components/forms/create-api-key-dialog";
import { CreateWebhookDialog } from "@/components/forms/create-webhook-dialog";
import { ApiKeysTable } from "@/components/tables/api-keys-table";
import { RequestLogsTable } from "@/components/tables/request-logs-table";
import { WebhooksTable } from "@/components/tables/webhooks-table";
import { BffError } from "@/lib/server/api-client";
import { listApiKeys } from "@/lib/server/api-keys-client";
import { listApplications } from "@/lib/server/applications-client";
import { requireDashboardSession } from "@/lib/server/auth";
import { listRequestLogs } from "@/lib/server/request-logs-client";
import { listWebhooks } from "@/lib/server/webhooks-client";

/** One (active) environment: its API keys + its webhook endpoints. Only rendered for an active
 *  environment — a locked live env is hidden entirely, not shown as unusable tables. `env` is the
 *  api-key env (test/live); the webhook env (sandbox/live) is derived from it. */
function EnvironmentSection({
  title,
  env,
  applicationId,
  keys,
  webhooks,
  logs,
  canManage,
}: {
  title: string;
  env: ApiKeyEnv;
  applicationId: string;
  keys: ApiKey[];
  webhooks: WebhookEndpointDto[];
  logs: ListRequestLogsResponse;
  canManage: boolean;
}) {
  const webhookEnv = env === "live" ? "live" : "sandbox";
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          {title}
        </h2>
        <Badge
          variant="outline"
          className="border-transparent bg-success/12 text-success"
        >
          Active
        </Badge>
      </div>

      <Tabs defaultValue="keys" className="gap-4">
        <TabsList>
          <TabsTrigger value="keys">API keys</TabsTrigger>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="keys">
          <Card>
            <CardHeader>
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
    </section>
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
  const liveActive = liveEnv?.status === "active";

  const emptyLogs: ListRequestLogsResponse = { logs: [], next_cursor: null };
  let keys: ApiKey[] = [];
  let webhooks: WebhookEndpointDto[] = [];
  let sandboxLogs: ListRequestLogsResponse = emptyLogs;
  let liveLogs: ListRequestLogsResponse = emptyLogs;
  let loadError = false;
  if (canRead) {
    try {
      [keys, webhooks, sandboxLogs, liveLogs] = await Promise.all([
        listApiKeys(app.id),
        listWebhooks(app.id),
        listRequestLogs(app.id, "sandbox"),
        liveActive
          ? listRequestLogs(app.id, "live")
          : Promise.resolve(emptyLogs),
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
            — keys, webhooks, and logs are scoped to an environment below.
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
        <div className="flex flex-col gap-8">
          <EnvironmentSection
            title="Sandbox"
            env="test"
            applicationId={app.id}
            keys={keys.filter((k) => k.env === "test")}
            webhooks={webhooks.filter((w) => w.env === "sandbox")}
            logs={sandboxLogs}
            canManage={canManage}
          />
          {/* The live environment is hidden entirely until go-live unlocks it — a workspace in
              sandbox mode never sees live tables it can't use. It appears once live is active. */}
          {liveActive ? (
            <EnvironmentSection
              title="Live"
              env="live"
              applicationId={app.id}
              keys={keys.filter((k) => k.env === "live")}
              webhooks={webhooks.filter((w) => w.env === "live")}
              logs={liveLogs}
              canManage={canManage}
            />
          ) : null}
        </div>
      )}
    </PageContainer>
  );
}
