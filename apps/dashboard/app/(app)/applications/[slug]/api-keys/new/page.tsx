import type { ApiKeyEnv } from "@app/contracts";
import { PageContainer } from "@app/ui/components/ui/app-shell";
import {
  PageHeader,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import { ErrorState } from "@app/ui/components/ui/states";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CreateApiKeyForm } from "@/components/forms/create-api-key-form";
import { listApplications } from "@/lib/server/applications-client";
import { requireDashboardSession } from "@/lib/server/auth";

/**
 * Dedicated create-API-key page (was a modal). The permission grid + secret reveal are roomier here.
 * `env` (sandbox/live) rides a query param from the keys tab so the key is scoped to the right
 * environment (ADR-0004). Requires api_keys:write; the link back is the application detail page.
 */
export default async function NewApiKeyPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ env?: string }>;
}) {
  const { slug } = await params;
  const { env: envParam } = await searchParams;
  const session = await requireDashboardSession();

  const { applications } = await listApplications();
  const app = applications.find((a) => a.slug === slug);
  if (!app) notFound();

  const backHref = `/applications/${slug}`;
  const env: ApiKeyEnv = envParam === "live" ? "live" : "sandbox";
  const envLabel = env === "live" ? "live" : "sandbox";

  return (
    <PageContainer>
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitle>Create {envLabel} key</PageHeaderTitle>
          <PageHeaderDescription>
            <Link href={backHref} className="underline underline-offset-2">
              {app.name}
            </Link>{" "}
            —{" "}
            {env === "live"
              ? "a live key spends real money and delivers to carriers."
              : "a sandbox key never charges or reaches real recipients."}{" "}
            The secret is shown once after creation.
          </PageHeaderDescription>
        </PageHeaderHeading>
      </PageHeader>

      {session.permissions.includes("api_keys:write") ? (
        <CreateApiKeyForm
          applicationId={app.id}
          env={env}
          backHref={backHref}
          playgroundUrl={process.env.PLAYGROUND_URL}
        />
      ) : (
        <ErrorState
          title="You don't have access to create keys"
          message="Ask a workspace owner or admin for developer access."
        />
      )}
    </PageContainer>
  );
}
