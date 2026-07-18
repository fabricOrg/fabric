import Link from "next/link";
import { redirect } from "next/navigation";
import { WorkspacePickerList } from "@/components/onboarding/workspace-picker-list";
import { requireDashboardUserSession } from "@/lib/server/auth";

/**
 * ADR-0007 workspace picker — OUR branded fork, replacing the WorkOS hosted org-selection screen.
 * Shown when a signed-in person holds several memberships and no valid selector cookie.
 */
export default async function WorkspacesPage() {
  const user = await requireDashboardUserSession();
  if (user.memberships.length === 0) redirect("/onboarding");

  return (
    <main className="relative flex min-h-screen flex-col bg-background">
      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-[440px] duration-200 animate-in fade-in">
          <div className="flex flex-col items-center gap-1.5 text-center">
            <div
              className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary text-xl font-bold text-primary-foreground shadow-sm"
              aria-hidden="true"
            >
              F
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Choose a workspace
            </h1>
            <p className="text-sm text-muted-foreground">
              Signed in as {user.email}
            </p>
          </div>

          <div className="mt-8">
            <WorkspacePickerList
              workspaces={user.memberships.map((membership) => ({
                tenantId: membership.tenantId,
                name: membership.workspaceName,
                role: membership.role,
                plan: membership.plan,
              }))}
            />
          </div>

          <div className="mt-6 flex items-center justify-center gap-4 text-sm text-muted-foreground">
            <Link
              href="/onboarding"
              className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
            >
              Create a workspace
            </Link>
            <span aria-hidden="true">·</span>
            <a
              href="/auth/logout"
              className="underline underline-offset-4 hover:text-foreground"
            >
              Sign out
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
