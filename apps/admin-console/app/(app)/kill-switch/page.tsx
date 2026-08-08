import type { KillSwitchDto } from "@app/contracts";
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

/**
 * The workspace picker needs names for ids, and the tenant list is keyset-paginated. Walk a bounded
 * number of pages: enough that the picker is complete on any realistic staff install, bounded so a
 * runaway cursor can never turn this page into an unbounded crawl. Failure is NOT fatal — the
 * platform breakers still work with an empty picker, and the dialog says so rather than pretending.
 */
const MAX_WORKSPACE_PAGES = 5;

async function loadWorkspaces(): Promise<WorkspaceOption[]> {
  const options: WorkspaceOption[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_WORKSPACE_PAGES; page += 1) {
    const { tenants, next_cursor } = await listTenants(
      cursor ? { cursor } : {},
    );
    options.push(...tenants.map((t) => ({ id: t.tenant_id, name: t.name })));
    if (!next_cursor) break;
    cursor = next_cursor;
  }
  return options.sort((a, b) => a.name.localeCompare(b.name));
}

export default async function KillSwitchPage() {
  const session = await requireAdminSession();
  const canManage = session.permissions.includes("staff:write");

  let switches: KillSwitchDto[] = [];
  let loadError = false;
  try {
    switches = (await listKillSwitches()).switches;
  } catch (error) {
    loadError = error instanceof KillSwitchApiError || error instanceof Error;
  }

  const workspaces = await loadWorkspaces().catch(() => []);

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Kill-switch
        </h1>
        <p className="text-sm text-muted-foreground">
          Operational switches over live traffic — platform-wide, or scoped to a
          single workspace. Every change needs a reason and is audited.
        </p>
      </div>

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
    </div>
  );
}
