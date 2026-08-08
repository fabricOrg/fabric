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
 * number of pages so a runaway cursor can never turn this page into an unbounded crawl. Failure is
 * NOT fatal — the platform breakers still work, and the card says per-workspace pausing is
 * unavailable rather than offering a control that leads nowhere.
 *
 * The list is ordered newest-first, so if the budget is exhausted it is the OLDEST accounts that
 * fall off — likely the largest senders. `truncated` is surfaced rather than swallowed: on an
 * incident surface, a workspace missing from the picker otherwise reads as "no such workspace".
 */
const MAX_WORKSPACE_PAGES = 5;

async function loadWorkspaces(): Promise<{
  options: WorkspaceOption[];
  truncated: boolean;
}> {
  const options: WorkspaceOption[] = [];
  let cursor: string | undefined;
  let truncated = false;
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

  // Both loads in parallel — the picker is not downstream of the switch list. Skipped entirely for
  // a read-only operator, who is never offered the control it feeds.
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
    </div>
  );
}
