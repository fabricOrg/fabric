import type { KillSwitchDto } from "@app/contracts";
import { KillSwitchList } from "@/components/kill-switch-list";
import { requireAdminSession } from "@/lib/server/auth";
import {
  KillSwitchApiError,
  listKillSwitches,
} from "@/lib/server/kill-switch-client";

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

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Kill-switch
        </h1>
        <p className="text-sm text-muted-foreground">
          Operational switches over live traffic. Every change needs a reason
          and is audited.
        </p>
      </div>

      {loadError ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Couldn&apos;t load kill switches right now. Try again shortly.
        </p>
      ) : (
        <KillSwitchList switches={switches} canManage={canManage} />
      )}
    </div>
  );
}
