import Link from "next/link";
import { OnboardingWorkspaceForm } from "@/components/onboarding/onboarding-workspace-form";
import { requireDashboardUserSession } from "@/lib/server/auth";

/**
 * ADR-0007 onboarding — the first branded surface after sign-up. The person is authenticated
 * (user-level session); here they NAME their workspace, which is created as a local transaction
 * (no IdP involvement) and selected. Also reachable later to create additional workspaces.
 */
export default async function OnboardingPage() {
  const user = await requireDashboardUserSession();
  const firstName = user.name?.trim().split(/\s+/)[0];
  const hasWorkspaces = user.memberships.length > 0;
  return (
    <main className="relative flex min-h-screen flex-col bg-background">
      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-[400px] duration-200 animate-in fade-in">
          <div className="flex flex-col items-center gap-1.5 text-center">
            <div
              className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary text-xl font-bold text-primary-foreground shadow-sm"
              aria-hidden="true"
            >
              F
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {firstName ? `Welcome, ${firstName}` : "Welcome to Fabric"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {hasWorkspaces
                ? "Create another workspace."
                : "Name your workspace to get started."}
            </p>
          </div>

          <div className="mt-8">
            <OnboardingWorkspaceForm />
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Your workspace starts in the sandbox with test credits — messages go
            to a virtual phone, never a carrier, until you request go-live.
          </p>

          {hasWorkspaces ? (
            <p className="mt-4 text-center text-sm text-muted-foreground">
              <Link
                href="/workspaces"
                className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
              >
                Back to your workspaces
              </Link>
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
