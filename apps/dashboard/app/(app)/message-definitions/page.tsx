import type {
  EmailVariantContent,
  MessageDefinitionState,
  SmsVariantContent,
} from "@app/contracts";
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
import { CreateDefinitionDialog } from "@/components/message-definitions/create-definition-dialog";
import { DefinitionActions } from "@/components/message-definitions/definition-actions";
import { DefinitionApplicationSelector } from "@/components/message-definitions/definition-application-selector";
import { variablesFromSchema } from "@/components/message-definitions/definition-authoring";
import { DefinitionDeveloperSetup } from "@/components/message-definitions/definition-developer-setup";
import { DefinitionPreviewPanel } from "@/components/message-definitions/definition-preview-panel";
import { BffError } from "@/lib/server/api-client";
import { listApplications } from "@/lib/server/applications-client";
import { requireDashboardSession } from "@/lib/server/auth";
import { listMessageDefinitions } from "@/lib/server/message-definitions-client";

const STATUS_STYLE: Record<string, string> = {
  active: "border-transparent bg-success/12 text-success",
  draft: "border-transparent bg-muted text-muted-foreground",
  archived: "border-transparent bg-muted text-muted-foreground",
};

/** The untyped SDK snippet for a definition's stable key (the "Use in code" panel). */
function useInCodeSnippet(state: MessageDefinitionState): string {
  const props = state.latest_version?.variable_schema.properties ?? {};
  const data = Object.keys(props)
    .map((k) => `    ${k}: "…"`)
    .join(",\n");
  const locale = state.latest_version?.default_locale ?? "en";
  const to =
    state.latest_version?.channel === "email" ? "user@example.com" : "+233…";
  return `await fabric.messages.send("${state.definition.key}", {\n  to: "${to}",\n  data: {\n${data}\n  },\n  locale: "${locale}",\n  idempotencyKey: "order-1042",\n});`;
}

function DefinitionCard({
  state,
  canWrite,
  canPublish,
}: {
  state: MessageDefinitionState;
  canWrite: boolean;
  canPublish: boolean;
}) {
  const { definition, latest_version, releases } = state;
  const releasedToSandbox = releases.length > 0;
  const sandboxSender = state.sender_bindings[0]?.sender_id;
  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-mono font-semibold leading-tight">
            {definition.key}
          </h3>
          <p className="text-sm text-muted-foreground">
            {latest_version ? `v${latest_version.version}` : "no version"} ·{" "}
            {releasedToSandbox ? "Released to sandbox" : "Not released"}
          </p>
        </div>
        <Badge variant="outline" className={STATUS_STYLE[definition.status]}>
          {definition.status}
        </Badge>
      </div>

      {latest_version ? (
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{latest_version.default_locale}</Badge>
          <Badge variant="secondary">{latest_version.channel}</Badge>
          {latest_version.channel === "sms" ? (
            <>
              <Badge variant="secondary">
                {(latest_version.content as SmsVariantContent).class}
              </Badge>
              <Badge variant="secondary">
                Sender: {sandboxSender ?? "Not bound"}
              </Badge>
            </>
          ) : null}
        </div>
      ) : null}

      {/* Use in code — the stable key is the developer contract. */}
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">
          Use in code
        </p>
        <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">
          <code>{useInCodeSnippet(state)}</code>
        </pre>
      </div>

      {latest_version?.channel === "sms" ? (
        <DefinitionPreviewPanel
          body={(latest_version.content as SmsVariantContent).body}
          schema={latest_version.variable_schema}
          fields={variablesFromSchema(latest_version.variable_schema)}
          definitionKey={definition.key}
        />
      ) : latest_version ? (
        // Email content is authored + previewed via the API/SDK for now; the dashboard email preview
        // panel is SDK-007 slice 4e. Show the subject read-only so the card isn't empty.
        <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
          Email version · subject:{" "}
          <span className="font-medium text-foreground">
            {(latest_version.content as EmailVariantContent).subject}
          </span>
          . Author and preview email content via the API; dashboard editing
          arrives in a later release.
        </div>
      ) : null}

      {canWrite ? (
        <div className="border-t pt-3">
          <DefinitionActions state={state} canPublish={canPublish} />
        </div>
      ) : null}
    </div>
  );
}

export default async function MessageDefinitionsPage({
  searchParams,
}: {
  searchParams: Promise<{ application?: string }>;
}) {
  const session = await requireDashboardSession();
  const canWrite = session.permissions.includes("definitions:write");
  const canPublish = session.permissions.includes("definitions:publish");

  const requestedApplication = (await searchParams).application;
  let definitions: MessageDefinitionState[] = [];
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
    if (selectedApplication) {
      definitions = (await listMessageDefinitions(selectedApplication.id))
        .definitions;
    }
  } catch (error) {
    loadError = error instanceof BffError || error instanceof Error;
  }

  return (
    <PageContainer>
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitle>Message definitions</PageHeaderTitle>
          <PageHeaderDescription>
            Reusable, versioned message content addressed by a stable key.
            Author once, publish to sandbox, and send by key from your code.
          </PageHeaderDescription>
        </PageHeaderHeading>
        {canWrite ? (
          <PageHeaderActions>
            {selectedApplication ? (
              <CreateDefinitionDialog
                initialApplicationId={selectedApplication.id}
              />
            ) : null}
          </PageHeaderActions>
        ) : null}
      </PageHeader>

      {applications.length > 0 && selectedApplication ? (
        <>
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Definitions are isolated to one application and its sandbox
              environment.
            </p>
            <DefinitionApplicationSelector
              applications={applications}
              selectedSlug={selectedApplication.slug}
            />
          </div>
          <DefinitionDeveloperSetup
            applicationName={selectedApplication.name}
          />
        </>
      ) : null}

      {loadError ? (
        <ErrorState
          title="Couldn't load definitions"
          message="The messaging service is temporarily unavailable. Refresh to try again."
        />
      ) : applications.length === 0 ? (
        <TableEmptyState
          title="Create an application first"
          description="Definitions belong to an application so keys, environments, and releases cannot cross boundaries."
        />
      ) : definitions.length === 0 ? (
        <TableEmptyState
          title="No message definitions yet"
          description="Author a reusable message with a stable key and a variable schema, then publish it to sandbox."
          action={
            canWrite && selectedApplication ? (
              <CreateDefinitionDialog
                initialApplicationId={selectedApplication.id}
              />
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {definitions.map((state) => (
            <DefinitionCard
              key={state.definition.id}
              state={state}
              canWrite={canWrite}
              canPublish={canPublish}
            />
          ))}
        </div>
      )}
    </PageContainer>
  );
}
