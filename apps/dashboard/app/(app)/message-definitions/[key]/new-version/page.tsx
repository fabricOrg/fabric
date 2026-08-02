import type { MessageDefinitionState } from "@app/contracts";
import { PageContainer } from "@app/ui/components/ui/app-shell";
import {
  PageHeader,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import { ErrorState } from "@app/ui/components/ui/states";
import { notFound } from "next/navigation";
import { DefinitionForm } from "@/components/message-definitions/definition-form";
import { BffError } from "@/lib/server/api-client";
import { listApplications } from "@/lib/server/applications-client";
import { requireDashboardSession } from "@/lib/server/auth";
import { listMessageDefinitions } from "@/lib/server/message-definitions-client";

/**
 * Author the NEXT version of an existing definition.
 *
 * The route is `/new-version`, not `/edit`, because the API only ever APPENDS a version — nothing
 * mutates one. While the segment was `edit` the breadcrumb read "Edit" directly above a title reading
 * "Create a new version", and one of the two had to be wrong; naming the segment after what actually
 * happens makes the trail, the title and the request agree.
 */
export default async function NewDefinitionVersionPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ application?: string }>;
}) {
  const { key } = await params;
  const definitionKey = decodeURIComponent(key);
  const session = await requireDashboardSession();
  if (!session.permissions.includes("definitions:write")) {
    return (
      <PageContainer>
        <ErrorState
          title="You can't author definitions"
          message="Ask a workspace owner or admin for access."
        />
      </PageContainer>
    );
  }

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

  if (!loadError && !state) notFound();

  const query = requested
    ? `?application=${encodeURIComponent(requested)}`
    : "";
  const detailHref = `/message-definitions/${encodeURIComponent(definitionKey)}${query}`;

  return (
    <PageContainer>
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitle>Create a new version</PageHeaderTitle>
          <PageHeaderDescription>
            The published version keeps serving traffic until you release this
            one.
          </PageHeaderDescription>
        </PageHeaderHeading>
      </PageHeader>

      {loadError || !state ? (
        <ErrorState
          title="Couldn't load this definition"
          message="The definitions service is temporarily unavailable. Refresh to try again."
        />
      ) : (
        <DefinitionForm
          applications={applications}
          initialDefinition={state}
          returnHref={detailHref}
        />
      )}
    </PageContainer>
  );
}
