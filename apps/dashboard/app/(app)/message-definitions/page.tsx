import type { MessageDefinitionState } from "@app/contracts";
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
import { BffError } from "@/lib/server/api-client";
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
  return `await fabric.messages.preview("${state.definition.key}", {\n${data}\n});`;
}

function DefinitionCard({
  state,
  canManage,
}: {
  state: MessageDefinitionState;
  canManage: boolean;
}) {
  const { definition, latest_version, releases } = state;
  const releasedToSandbox = releases.length > 0;
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

      {/* Use in code — the stable key is the developer contract. */}
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">
          Use in code
        </p>
        <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">
          <code>{useInCodeSnippet(state)}</code>
        </pre>
      </div>

      {canManage ? (
        <div className="border-t pt-3">
          <DefinitionActions
            id={definition.id}
            latestVersionId={latest_version?.id ?? null}
            status={definition.status}
          />
        </div>
      ) : null}
    </div>
  );
}

export default async function MessageDefinitionsPage() {
  const session = await requireDashboardSession();
  const canManage = session.role === "owner" || session.role === "admin";

  let definitions: MessageDefinitionState[] = [];
  let loadError = false;
  try {
    definitions = (await listMessageDefinitions()).definitions;
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
        {canManage ? (
          <PageHeaderActions>
            <CreateDefinitionDialog />
          </PageHeaderActions>
        ) : null}
      </PageHeader>

      {loadError ? (
        <ErrorState
          title="Couldn't load definitions"
          message="The messaging service is temporarily unavailable. Refresh to try again."
        />
      ) : definitions.length === 0 ? (
        <TableEmptyState
          title="No message definitions yet"
          description="Author a reusable message with a stable key and a variable schema, then publish it to sandbox."
          action={canManage ? <CreateDefinitionDialog /> : undefined}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {definitions.map((state) => (
            <DefinitionCard
              key={state.definition.id}
              state={state}
              canManage={canManage}
            />
          ))}
        </div>
      )}
    </PageContainer>
  );
}
