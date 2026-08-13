import type { MessageDefinitionState } from "@app/contracts";
import { PageContainer } from "@app/ui/components/ui/app-shell";
import { Button } from "@app/ui/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
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
import { Braces, GitBranch, Plus, Rocket } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { DefinitionApplicationSelector } from "@/components/message-definitions/definition-application-selector";
import { DefinitionDeveloperSetup } from "@/components/message-definitions/definition-developer-setup";
import { DefinitionSummaryCard } from "@/components/message-definitions/definition-summary-card";
import { BffError } from "@/lib/server/api-client";
import { listApplications } from "@/lib/server/applications-client";
import { requireDashboardSession } from "@/lib/server/auth";
import { listMessageDefinitions } from "@/lib/server/message-definitions-client";

function DefinitionEmptyPanel({
  applicationSlug,
  canWrite,
}: {
  applicationSlug: string;
  canWrite: boolean;
}) {
  const href = `/message-definitions/new?application=${encodeURIComponent(applicationSlug)}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Design the first reusable message</CardTitle>
        {canWrite ? (
          <CardAction>
            <Button asChild>
              <Link href={href}>
                <Plus data-icon="inline-start" />
                New definition
              </Link>
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        <DefinitionStep icon={<Braces />} title="Name the key" />
        <DefinitionStep icon={<GitBranch />} title="Version content" />
        <DefinitionStep icon={<Rocket />} title="Release sandbox" />
      </CardContent>
    </Card>
  );
}

function DefinitionStep({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-md border bg-muted/20 p-4">
      <span className="flex size-8 items-center justify-center border bg-background text-primary [&_svg]:size-4">
        {icon}
      </span>
      <span className="flex flex-col gap-1">
        <span className="font-medium text-sm">{title}</span>
      </span>
    </div>
  );
}

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
            Reusable message content addressed by a stable key.
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
        <div className="mb-4 flex justify-end">
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
        <DefinitionEmptyPanel
          applicationSlug={selectedApplication?.slug ?? ""}
          canWrite={canWrite && Boolean(selectedApplication)}
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
