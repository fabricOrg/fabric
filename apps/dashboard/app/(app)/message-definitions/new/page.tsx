import { PageContainer } from "@app/ui/components/ui/app-shell";
import {
  PageHeader,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import { ErrorState } from "@app/ui/components/ui/states";
import { DefinitionForm } from "@/components/message-definitions/definition-form";
import { BffError } from "@/lib/server/api-client";
import { listApplications } from "@/lib/server/applications-client";
import { requireDashboardSession } from "@/lib/server/auth";

/**
 * Authoring a definition on its own page, not in a dialog.
 *
 * The form carries an application, channel, stable key, locales, message class, sender, body, a
 * variable-schema builder and a live preview — ~470 lines of it. In a modal that meant a scrolling
 * box where the submit button and the field it was complaining about could not be on screen together,
 * and no URL to link a colleague to. A page gets deep-linking, browser back, and room to breathe.
 */
export default async function NewMessageDefinitionPage({
  searchParams,
}: {
  searchParams: Promise<{ application?: string }>;
}) {
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
  let loadError = false;
  try {
    applications = (await listApplications()).applications;
  } catch (error) {
    loadError = error instanceof BffError || error instanceof Error;
  }
  const selected =
    applications.find((application) => application.slug === requested) ??
    applications[0];
  const returnHref = selected
    ? `/message-definitions?application=${encodeURIComponent(selected.slug)}`
    : "/message-definitions";

  return (
    <PageContainer>
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitle>New message definition</PageHeaderTitle>
        </PageHeaderHeading>
      </PageHeader>

      {loadError ? (
        <ErrorState
          title="Couldn't load your applications"
          message="A definition belongs to one application. Refresh to try again."
        />
      ) : (
        <DefinitionForm
          applications={applications}
          initialApplicationId={selected?.id ?? ""}
          returnHref={returnHref}
        />
      )}
    </PageContainer>
  );
}
