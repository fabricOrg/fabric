import type { MessageDefinitionState } from "@app/contracts";
import { PageContainer } from "@app/ui/components/ui/app-shell";
import { Button } from "@app/ui/components/ui/button";
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import { ErrorState, TableEmptyState } from "@app/ui/components/ui/states";
import { Plus } from "lucide-react";
import Link from "next/link";
import { DefinitionApplicationSelector } from "@/components/message-definitions/definition-application-selector";
import { DefinitionDeveloperSetup } from "@/components/message-definitions/definition-developer-setup";
import { DefinitionSummaryCard } from "@/components/message-definitions/definition-summary-card";
import { BffError } from "@/lib/server/api-client";
import { listApplications } from "@/lib/server/applications-client";
import { requireDashboardSession } from "@/lib/server/auth";
import { listMessageDefinitions } from "@/lib/server/message-definitions-client";

/** The untyped SDK snippet for a definition's stable key (the "Use in code" panel). */
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
              <DefinitionDeveloperSetup
                applicationName={selectedApplication.name}
              />
            ) : null}
            {selectedApplication ? (
              <Button asChild>
                <Link
                  href={`/message-definitions/new?application=${encodeURIComponent(selectedApplication.slug)}`}
                >
                  <Plus data-icon="inline-start" />
                  New definition
                </Link>
              </Button>
            ) : null}
          </PageHeaderActions>
        ) : null}
      </PageHeader>

      {applications.length > 0 && selectedApplication ? (
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
              <Button asChild>
                <Link
                  href={`/message-definitions/new?application=${encodeURIComponent(selectedApplication.slug)}`}
                >
                  <Plus data-icon="inline-start" />
                  New definition
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {definitions.map((state) => (
            <DefinitionSummaryCard
              key={state.definition.id}
              state={state}
              applicationSlug={selectedApplication?.slug ?? ""}
              canWrite={canWrite}
              canPublish={canPublish}
            />
          ))}
        </div>
      )}
    </PageContainer>
  );
}
