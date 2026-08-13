import type { KillSwitchDto } from "@app/contracts";
import { PageContainer } from "@app/ui/components/ui/app-shell";
import {
  PageHeader,
  PageHeaderDescription,
  PageHeaderHeading,
  PageHeaderTitle,
} from "@app/ui/components/ui/page-header";
import {
  KillSwitchList,
  type WorkspaceOption,
} from "@/components/kill-switch-list";
import { requireAdminSession } from "@/lib/server/auth";
import {
  KillSwitchApiError,
  listKillSwitches,
} from "@/lib/server/kill-switch-client";
import { listTenants } from "@/lib/server/tenants-client";

const MAX_WORKSPACE_PAGES = 5;

async function loadWorkspaces(): Promise<{
  options: WorkspaceOption[];
  truncated: boolean;
}> {
  const options: WorkspaceOption[] = [];
  let cursor: string | undefined;
  let truncated = false;
  // The picker is supporting context for a risky operation, so keep it bounded and non-fatal.
  for (let page = 0; page < MAX_WORKSPACE_PAGES; page += 1) {
    const { tenants, next_cursor } = await listTenants(
      cursor ? { cursor } : {},
    );
    options.push(...tenants.map((t) => ({ id: t.tenant_id, name: t.name })));
    if (!next_cursor) break;
    cursor = next_cursor;
    truncated = page === MAX_WORKSPACE_PAGES - 1;
  }
  return {
    options: options.sort((a, b) => a.name.localeCompare(b.name)),
    truncated,
  };
}

export default async function KillSwitchPage() {
  const session = await requireAdminSession();
  const canManage = session.permissions.includes("staff:write");

  const [switchResult, workspaceResult] = await Promise.all([
    listKillSwitches().then(
      (r) => ({ ok: true as const, switches: r.switches }),
      (error: unknown) => ({
        ok: false as const,
        fatal: error instanceof KillSwitchApiError || error instanceof Error,
      }),
    ),
    canManage
      ? loadWorkspaces().catch(() => ({ options: [], truncated: false }))
      : Promise.resolve({ options: [], truncated: false }),
  ]);

  const switches: KillSwitchDto[] = switchResult.ok
    ? switchResult.switches
    : [];
  const loadError = !switchResult.ok;
  const workspaces = workspaceResult.options;

  return (
    <PageContainer>
      <PageHeader>
        <PageHeaderHeading>
          <PageHeaderTitle>Kill-switch</PageHeaderTitle>
          <PageHeaderDescription>
            Operational switches over live traffic - platform-wide, or scoped to
            a single workspace. Every change needs a reason and is audited.
          </PageHeaderDescription>
        </PageHeaderHeading>
      </PageHeader>

      {workspaceResult.truncated ? (
        <p className="text-sm text-muted-foreground">
          The workspace picker shows the {workspaces.length} most recent
          workspaces. Older ones are not listed.
        </p>
      ) : null}

      {loadError ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Couldn&apos;t load kill switches right now. Try again shortly.
        </p>
      ) : (
        <KillSwitchList
          switches={switches}
          workspaces={workspaces}
          canManage={canManage}
        />
      )}
    </PageContainer>
  );
}
