import type {
  EmailVariantContent,
  MessageDefinitionState,
  SmsVariantContent,
} from "@app/contracts";
import { PageContainer } from "@app/ui/components/ui/app-shell";
import { Badge } from "@app/ui/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
} from "@app/ui/components/ui/card";
import {
  PageHeader,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import { ErrorState } from "@app/ui/components/ui/states";
import { notFound } from "next/navigation";
import { CopyButton } from "@/components/copy-button";
import { DefinitionActions } from "@/components/message-definitions/definition-actions";
import { variablesFromSchema } from "@/components/message-definitions/definition-authoring";
import { DefinitionPreviewPanel } from "@/components/message-definitions/definition-preview-panel";
import { EmailPreviewPanel } from "@/components/message-definitions/email-preview-panel";
import { BffError } from "@/lib/server/api-client";
import { listApplications } from "@/lib/server/applications-client";
import { requireDashboardSession } from "@/lib/server/auth";
import { listMessageDefinitions } from "@/lib/server/message-definitions-client";

/** The developer contract: the stable key plus the shape its data must take. */
function sendSnippetFor(state: MessageDefinitionState): string {
  const schema = state.latest_version?.variable_schema;
  const fields = schema ? variablesFromSchema(schema) : [];
  const data = fields.map((field) => "    " + field.name + ': "…"').join(",\n");
  const locale = state.latest_version?.default_locale ?? "en";
  const to =
    state.latest_version?.channel === "email" ? "user@example.com" : "+233…";
  return [
    `await fabric.messages.send("${state.definition.key}", {`,
    `  to: "${to}",`,
    "  data: {",
    data,
    "  },",
    `  locale: "${locale}",`,
    '  idempotencyKey: "order-1042",',
    "});",
  ].join("\n");
}

/**
 * One definition, in full. The list shows identity and a content glance; everything that is a TOOL
 * rather than a summary lives here — the code snippet, the interactive preview with its variable
 * inputs and eligibility check, and the lifecycle actions. Rendering all of that per row made a list
 * of five definitions five screens tall and impossible to scan.
 */
export default async function MessageDefinitionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ application?: string }>;
}) {
  const { key } = await params;
  const definitionKey = decodeURIComponent(key);
  const session = await requireDashboardSession();
  const canWrite = session.permissions.includes("definitions:write");
  const canPublish = session.permissions.includes("definitions:publish");

  const requested = (await searchParams).application;
  let applications: Awaited<
    ReturnType<typeof listApplications>
  >["applications"] = [];
  let state: MessageDefinitionState | undefined;
  let loadError = false;
  try {
    applications = (await listApplications()).applications;
    const selected =
      applications.find((application) => application.slug === requested) ??
      applications[0];
    if (selected) {
      const { definitions } = await listMessageDefinitions(selected.id);
      state = definitions.find(
        (entry) => entry.definition.key === definitionKey,
      );
    }
  } catch (error) {
    loadError = error instanceof BffError || error instanceof Error;
  }

  // A key that does not exist is a 404, but a FETCH failure is not — telling someone their definition
  // is gone because the service blinked is the empty-vs-error conflation in its most alarming form.
  if (!loadError && !state) notFound();

  const version = state?.latest_version;
  const sms = version?.channel === "sms";
  // Name the released version rather than asserting the latest one serves traffic — see the card.
  const releasedRef = state?.releases[0];
  const releaseLabel = !releasedRef
    ? "Not released"
    : releasedRef.version_id === version?.id
      ? "Released to sandbox"
      : "Draft — an earlier version serves sandbox";
  // Default first, then any additional locale the version actually carries — the same set the release
  // check will accept, so the picker cannot offer a value the server must reject.
  const localeOptions = version
    ? [
        version.default_locale,
        ...Object.keys(
          (version.content as { locales?: Record<string, unknown> }).locales ??
            {},
        ).filter((locale) => locale !== version.default_locale),
      ]
    : [];
  const sender = state?.sender_bindings[0]?.sender_id;

  return (
    <PageContainer>
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitle className="font-mono">
            {definitionKey}
          </PageHeaderTitle>
          {state ? (
            <PageHeaderDescription>
              {version ? `v${version.version}` : "no version"} · {releaseLabel}
            </PageHeaderDescription>
          ) : null}
        </PageHeaderHeading>
      </PageHeader>

      {loadError || !state ? (
        <ErrorState
          title="Couldn't load this definition"
          message="The definitions service is temporarily unavailable. Refresh to try again."
        />
      ) : (
        // Two columns so the lifecycle actions sit together on one side instead of competing with the
        // title for the header, and so the reader's eye has one column to travel down. Collapses to a
        // single column below `lg`, actions last — on a phone the content is what you came for.
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{state.definition.status}</Badge>
              {version ? (
                <>
                  <Badge variant="secondary">{version.channel}</Badge>
                  <Badge variant="secondary">{version.default_locale}</Badge>
                  {sms ? (
                    <>
                      <Badge variant="secondary">
                        {(version.content as SmsVariantContent).class}
                      </Badge>
                      <Badge variant="secondary">
                        Sender: {sender ?? "Not bound"}
                      </Badge>
                    </>
                  ) : (
                    <Badge variant="secondary">
                      From:{" "}
                      {(version.content as EmailVariantContent).from ??
                        "sandbox default"}
                    </Badge>
                  )}
                </>
              ) : null}
            </div>

            <Card>
              <CardHeader>
                <p className="font-medium text-sm">Use in code</p>
                <CardAction>
                  <CopyButton
                    value={sendSnippetFor(state)}
                    ariaLabel="Copy the send snippet"
                    toastLabel="Send snippet copied"
                  />
                </CardAction>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">
                  <code>{sendSnippetFor(state)}</code>
                </pre>
              </CardContent>
            </Card>

            {version && sms ? (
              <Card>
                <CardContent>
                  <DefinitionPreviewPanel
                    body={(version.content as SmsVariantContent).body}
                    schema={version.variable_schema}
                    fields={variablesFromSchema(version.variable_schema)}
                    definitionKey={state.definition.key}
                    locales={localeOptions}
                  />
                </CardContent>
              </Card>
            ) : version ? (
              <Card>
                <CardContent>
                  <EmailPreviewPanel
                    subject={(version.content as EmailVariantContent).subject}
                    text={(version.content as EmailVariantContent).text ?? ""}
                    html={(version.content as EmailVariantContent).html ?? ""}
                    schema={version.variable_schema}
                    fields={variablesFromSchema(version.variable_schema)}
                    definitionKey={state.definition.key}
                  />
                </CardContent>
              </Card>
            ) : null}
          </div>

          {canWrite ? (
            <Card className="gap-3 px-4 py-4">
              <p className="font-medium text-sm">Actions</p>
              <p className="text-muted-foreground text-xs">
                A published version is immutable — a new version is created
                instead of editing this one.
              </p>
              {/* Answers the obvious question a live workspace asks here: sandbox is not a choice,
                  it is the only environment the API will publish to today. Saying so beats leaving
                  the reader to infer it from a button label. */}
              <p className="text-muted-foreground text-xs">
                Sandbox is the only target for now — publishing to live
                isn&apos;t available yet.
              </p>
              <DefinitionActions
                state={state}
                canPublish={canPublish}
                applicationSlug={requested}
              />
            </Card>
          ) : null}
        </div>
      )}
    </PageContainer>
  );
}
